import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type ContentRow, type MappingRow, type Session, type SkillNodeRow, type SkillsResult, type UploadResult } from "../api";
import { Banner, Button, Card, Chip, Field, PageShell, type GovState } from "../components";
import { NotificationBell } from "../NotificationBell";
import { SkillPicker, SubjectPicker } from "../SkillPicker";
import { CurriculumReview } from "../CurriculumReview";
import { extractTextFromFile } from "../fileText";

const FILE_TYPES = ["pdf", "doc", "docx", "ppt", "pptx", "txt", "md", "link"] as const;

/**
 * ONE derived status per item, by precedence. Items used to show up to five
 * chips at once — including flatly contradictory pairs like "Processing failed"
 * beside "Pending approval" — leaving the teacher to reverse-engineer the
 * pipeline. Precedence makes a contradiction impossible by construction.
 */
type ItemState = "broken" | "processing" | "ready" | "action";

function itemState(r: ContentRow): ItemState {
  if (r.ingestionStatus === "failed") return "broken";
  if (r.ingestionStatus === "pending" || r.ingestionStatus === "processing") return "processing";
  if (r.status === "approved" || r.status === "published") return "ready";
  return "action";
}

const STATE_CHIP: Record<ItemState, { state: GovState; label: string }> = {
  broken: { state: "pending", label: "Couldn't be read" },
  processing: { state: "draft", label: "Processing" },
  ready: { state: "approved", label: "Ready to use" },
  action: { state: "draft", label: "Action needed" },
};

/**
 * The governance gates in the teacher's language, each with the reason it
 * exists. Same five gates as before — renamed from pipeline jargon
 * (ingestion / classification / attestation) into what they mean.
 */
function checklist(r: ContentRow): { label: string; why: string; done: boolean }[] {
  return [
    { label: "Uploaded", why: "Your file is in the library.", done: true },
    { label: "Text extracted", why: "We read the file so questions can be grounded in it.", done: r.ingestionStatus === "ingested" },
    { label: "Subject confirmed", why: "You check the suggested subject and topic.", done: r.classification?.status === "approved" },
    { label: "Rights confirmed", why: "You confirm it's yours to use with students.", done: r.rightsAttested },
    { label: "Approved", why: "Nothing reaches students until you approve it.", done: r.status === "approved" || r.status === "published" },
    { label: "Filed in the curriculum", why: "Links it to a subject so it can ground lessons and assessments.", done: r.mappedNodeIds.length > 0 },
  ];
}

/**
 * The subject this item appears to be about when NO signed-off curriculum
 * covers it — otherwise null. Prefers an explicit official-syllabus tag, then
 * the confirmed classification. Without this the mapping picker just lists
 * whatever curriculum does exist, so a Technology syllabus was offered Year 8
 * maths skills with nothing saying why.
 */
function missingCurriculumFor(r: ContentRow, skills: SkillsResult): string | null {
  if (!skills.signedOff) return null;
  const subject = r.officialSyllabus?.subject ?? r.classification?.subject ?? null;
  if (!subject) return null;
  const norm = (s: string) => s.trim().toLowerCase();
  // "Unknown"/"Unclassified" is the classifier admitting it doesn't know — not a
  // subject. Claiming "no Unknown curriculum is signed off" would be nonsense.
  if (["unknown", "unclassified", "other", "general"].includes(norm(subject))) return null;
  const covered = skills.graphs.some((g) => g.subject && norm(g.subject) === norm(subject));
  return covered ? null : subject;
}

/**
 * TCH-1 (+minimal TCH-3) — the Teacher Content Studio. Upload material, walk it
 * through the governed pipeline (ingest -> classify -> approve classification ->
 * attest rights -> approve), then map it to signed-off skill-graph nodes. Every
 * governance step is an explicit button — nothing advances by itself.
 */
export function TeacherContent({ session, displayName, onBack, onSignOut }: {
  session: Session; displayName: string; onBack: () => void; onSignOut: () => void;
}) {
  const [rows, setRows] = useState<ContentRow[] | null>(null);
  const [myDepartment, setMyDepartment] = useState<string | null>(null);
  const [skills, setSkills] = useState<SkillsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // itemId (or "upload") in flight
  const [open, setOpen] = useState<string | null>(null); // expanded item
  // Two mapping targets, because they are two different jobs (#19): the subject
  // is where material is filed by default; a concept is an optional refinement
  // for material that genuinely only teaches one thing.
  const [mapSubject, setMapSubject] = useState("");
  const [mapNode, setMapNode] = useState("");
  // TCH-2/3 detail state for the expanded item
  const [detail, setDetail] = useState<{
    versions: Awaited<ReturnType<typeof api.contentVersions>>;
    mappings: MappingRow[];
    classes: { id: string; name: string }[];
  } | null>(null);
  const [overrideNode, setOverrideNode] = useState("");
  const [preview, setPreview] = useState<{ itemId: string; title: string; sections: { heading: string; text: string }[] } | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [curricula, setCurricula] = useState<Awaited<ReturnType<typeof api.curricula>> | null>(null);
  const [openCurriculum, setOpenCurriculum] = useState<string | null>(null);
  const [remapPrompt, setRemapPrompt] = useState<{ mappingId: string; newNodeId: string } | null>(null);
  // Official syllabus tagging (ADR-0035) — subject/year/NESA-link form for the expanded item
  const [syllabusSubject, setSyllabusSubject] = useState("");
  const [syllabusYear, setSyllabusYear] = useState("");
  const [syllabusUrl, setSyllabusUrl] = useState("");

  // Upload form
  const [title, setTitle] = useState("");
  const [fileType, setFileType] = useState<string>("pdf");
  const [text, setText] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [pickedFile, setPickedFile] = useState<string | null>(null); // file name shown after extraction
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [content, sk] = await Promise.all([api.listContent(session), api.skills(session)]);
      setRows(content); setSkills(sk);
    } catch (e) { setError((e as Error).message); }
  }, [session]);

  const refreshCurricula = useCallback(async () => {
    try { setCurricula(await api.curricula(session)); }
    catch (e) { setError((e as Error).message); }
  }, [session]);

  useEffect(() => { void refresh(); void refreshCurricula(); }, [refresh, refreshCurricula]);

  // The teacher's own department, so the share control offers it by name — it
  // was hardcoded to "Mathematics", which made department sharing unusable for
  // every other department (#18).
  useEffect(() => {
    api.me(session).then((me) => setMyDepartment(me.department)).catch(() => setMyDepartment(null));
  }, [session]);

  // Load the expanded item's detail (versions, mappings, share targets).
  useEffect(() => {
    if (!open) { setDetail(null); return; }
    setRemapPrompt(null); setOverrideNode("");
    Promise.all([api.contentVersions(session, open), api.contentMappings(session, open), api.teacherClasses(session)])
      .then(([versions, mappings, classes]) => setDetail({ versions, mappings, classes }))
      .catch(() => setDetail(null)); // pre-pipeline items may not resolve yet — the panel just hides
  }, [session, open, rows]);

  const share = async (itemId: string, value: string) => {
    setError(null);
    try {
      const shareScope = value === "private" ? { type: "private" as const }
        : value.startsWith("class:") ? { type: "class" as const, classId: value.slice(6) }
        : { type: "department" as const, department: value.slice(11) };
      await api.setContentShare(session, itemId, shareScope);
      setNotice("Sharing updated.");
    } catch (e) { setError((e as Error).message); }
  };

  /**
   * Remove a filing. This is how a mis-filed item gets re-filed: remove the
   * wrong mapping and the subject picker reappears on the item (it's unmapped
   * again). The exact path the mis-filed NESA syllabus needed in production.
   */
  const unmap = async (mappingId: string) => {
    if (!window.confirm("Remove this filing? The material stops grounding that part of the curriculum until you file it again.")) return;
    setError(null); setNotice(null);
    try {
      await api.removeMapping(session, mappingId);
      setNotice("Filing removed — file the material again below.");
      await refresh();
    } catch (e) { setError((e as Error).message); }
  };

  const override = async (mappingId: string, newNodeId: string, remapHistorical?: boolean) => {
    setError(null); setNotice(null);
    try {
      const result = await api.overrideMapping(session, mappingId, newNodeId, remapHistorical);
      if (result.requiresDecision) { setRemapPrompt({ mappingId, newNodeId }); return; }
      setRemapPrompt(null); setOverrideNode("");
      setNotice("Mapping overridden — reflected everywhere this content is used.");
      await refresh();
    } catch (e) { setError((e as Error).message); }
  };

  /** A real file chosen: extract its text in the browser, fill the form, let the teacher review before uploading. */
  const chooseFile = async (file: File | null) => {
    if (!file) return;
    setError(null); setNotice(null); setExtracting(true); setPickedFile(null);
    try {
      const extracted = await extractTextFromFile(file);
      if (!title.trim()) setTitle(extracted.title);
      setFileType(extracted.fileType);
      setText(extracted.text);
      setPickedFile(file.name);
      setNotice(`Extracted ${extracted.text.length.toLocaleString()} characters from ${file.name} — review below, then Upload.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExtracting(false);
      if (fileInputRef.current) fileInputRef.current.value = ""; // re-choosing the same file re-fires onChange
    }
  };

  const upload = async () => {
    setError(null); setNotice(null); setBusy("upload");
    try {
      const result: UploadResult = await api.uploadContent(session, { title, fileType, text });
      if (result.status === "rejected") {
        setError(`Upload rejected (${result.reason.replace(/_/g, " ")}): ${result.message}`);
      } else {
        setNotice(result.flags.includes("likely_duplicate")
          ? "Uploaded — flagged as a likely duplicate of existing material."
          : "Uploaded. Walk it through the approval steps below.");
        setTitle(""); setText(""); setPickedFile(null);
        setOpen(result.contentItemId);
        await refresh();
      }
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };

  const step = async (itemId: string, s: Parameters<typeof api.contentStep>[2]) => {
    setError(null); setBusy(itemId);
    try { await api.contentStep(session, itemId, s); await refresh(); }
    catch (e) { setError(e instanceof ApiError ? `${e.message}` : (e as Error).message); }
    finally { setBusy(null); }
  };

  const map = async (itemId: string, nodeId: string, after: () => void) => {
    if (!nodeId) return;
    setError(null); setBusy(itemId);
    try { await api.mapContent(session, itemId, [nodeId]); after(); await refresh(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  };

  const markSyllabus = async (itemId: string) => {
    const yearLevel = Number(syllabusYear);
    if (!syllabusSubject.trim() || !yearLevel || !syllabusUrl.trim()) return;
    setError(null); setBusy(itemId);
    try {
      await api.markOfficialSyllabus(session, itemId, { subject: syllabusSubject.trim(), yearLevel, sourceUrl: syllabusUrl.trim() });
      setSyllabusSubject(""); setSyllabusYear(""); setSyllabusUrl("");
      setNotice("Marked as the official syllabus — every teacher of this subject/year will see it.");
      await refresh();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  };

  /**
   * Draft a curriculum from this syllabus, then offer sign-off as a separate,
   * deliberate step — the draft is AI-written from the document and must be
   * checked against it before any teacher maps or generates against it.
   */
  const draftCurriculum = async (itemId: string) => {
    setError(null); setNotice(null); setBusy(itemId);
    try {
      const drafted = await api.draftCurriculumFromSyllabus(session, itemId);
      setNotice(
        `Drafted ${drafted.skills} concepts across ${drafted.strands} topic areas for ${drafted.subject} Year ${drafted.yearLevel}. ` +
        "It's a DRAFT — it's open under Curricula above; read it against the syllabus, then sign it off.",
      );
      // Open the new draft immediately: the teacher asked for a curriculum, so
      // put them in front of it rather than telling them to go find it.
      await Promise.all([refresh(), refreshCurricula()]);
      setOpenCurriculum(drafted.versionId);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };

  /**
   * Retire material. Something still referenced by active work asks for
   * confirmation first — the reference survives as a labelled archived source
   * rather than becoming a broken link.
   */
  const archiveItem = async (itemId: string, confirm = false) => {
    setError(null); setNotice(null); setBusy(itemId);
    try {
      const r = await api.archiveContent(session, itemId, confirm);
      if (!r.archived && r.warning === "in-use") {
        setBusy(null);
        const refs = (r.references ?? []).length;
        if (window.confirm(`This material is still used by ${refs} active item${refs === 1 ? "" : "s"}. Archive it anyway? Existing references stay, marked as archived.`)) {
          return archiveItem(itemId, true);
        }
        return;
      }
      setNotice("Archived — it stays as a reference wherever it was already used.");
      await refresh();
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };

  /** Read what you're approving — the extracted text, section by section. */
  const togglePreview = async (itemId: string) => {
    if (preview?.itemId === itemId) return setPreview(null);
    setError(null);
    try {
      const p = await api.contentSections(session, itemId);
      setPreview({ itemId, ...p });
    } catch (e) { setError((e as Error).message); }
  };

  /** The next pipeline action for an item, or null when fully approved. */
  const nextAction = (r: ContentRow): { step: Parameters<typeof api.contentStep>[2]; label: string; governance?: boolean } | null => {
    if (r.status === "approved" || r.status === "published") return null;
    if (r.ingestionStatus === "pending" || r.ingestionStatus === "processing") return { step: "ingest", label: "Process (ingest)" };
    if (r.ingestionStatus === "failed") return null; // terminal failure — honest state, re-upload
    if (!r.classification) return { step: "classify", label: "Suggest classification (AI)" };
    if (r.classification.status !== "approved") return { step: "classification/approve", label: "Approve classification", governance: true };
    if (!r.rightsAttested) return { step: "attest", label: "Attest rights", governance: true };
    return { step: "approve", label: "Approve content", governance: true };
  };

  /**
   * Teachable nodes grouped under "Subject · Year" for the override dropdown,
   * so a Technology item can never be re-pointed into the maths curriculum
   * without the teacher seeing which subject they picked.
   */
  const overrideGroups = (() => {
    if (!skills?.signedOff) return [] as { label: string; nodes: SkillNodeRow[] }[];
    const teachable: SkillNodeRow[] = skills.nodes.filter((n) => n.type === "subskill" || n.type === "skill");
    const groups = new Map<string, SkillNodeRow[]>();
    for (const n of teachable) {
      const label = n.subject ? `${n.subject}${n.yearLevel != null ? ` · Year ${n.yearLevel}` : ""}` : "Skills";
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label)!.push(n);
    }
    return [...groups.entries()].map(([label, nodes]) => ({ label, nodes }));
  })();

  return (
    <PageShell topRight={<NotificationBell session={session} />} displayName={displayName} title="Content Studio" roleTag="Teacher" backLabel="Back to teacher home"
      onBack={onBack} onSignOut={onSignOut}
      lede="Only material you explicitly approve joins the pool that grounds assessments and suggestions. Each governance step below is yours to take — nothing is approved automatically.">
      {error && <Banner kind="error">{error}</Banner>}
      {notice && <Banner kind="brand">{notice}</Banner>}
      {skills && !skills.signedOff && (
        <Banner kind="warn">The skill graph isn't signed off yet — approved content can't be mapped until your administrator signs it off.</Banner>
      )}

      {/* Curricula live here rather than behind their own tile: the loop is
          approve syllabus → draft curriculum → review → sign off, and it all
          belongs to the material a teacher is already working with. A curriculum
          with no source document (an imported one) still needs a teacher-facing
          home, which is why this is a list and not only an inline panel. */}
      <Card>
        <div className="card__head">
          <h2 className="section">Curricula {curricula ? `— ${curricula.length}` : ""}</h2>
          <p className="muted">What your school teaches against. Draft a new one from an approved syllabus below, then review and sign it off here.</p>
        </div>
        {!curricula ? <div className="muted">Loading…</div>
          : curricula.length === 0 ? <Banner kind="brand">No curricula yet — approve a syllabus below and draft one from it.</Banner>
          : (
            <ul className="people">
              {curricula.map((c) => (
                <li className="person" key={c.versionId} style={{ display: "block" }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <button className="linkish" aria-expanded={openCurriculum === c.versionId}
                      onClick={() => setOpenCurriculum(openCurriculum === c.versionId ? null : c.versionId)}>
                      <strong>{c.scopeLabel}</strong>
                    </button>
                    <span className="person__meta">{c.concepts} concepts</span>
                    <span className="spacer" />
                    {c.status === "signed_off"
                      ? <Chip state="approved">Signed off</Chip>
                      : <Chip state="draft">Draft — review to sign off</Chip>}
                  </div>
                  {openCurriculum === c.versionId && (
                    <CurriculumReview session={session} versionId={c.versionId} onChanged={() => void refreshCurricula()} />
                  )}
                </li>
              ))}
            </ul>
          )}
      </Card>

      <Card>
        <div className="card__head"><h2 className="section">Upload material</h2></div>
        <Field
          label="File"
          hint="Choose a .pdf, .docx, .txt or .md — its text is extracted in your browser (the file itself never leaves your machine) and goes through the same scan/classify/attest/approve pipeline. Or paste text below instead."
        >
          <input
            ref={fileInputRef}
            className="input"
            type="file"
            accept=".pdf,.docx,.txt,.md"
            disabled={extracting}
            onChange={(e) => void chooseFile(e.target.files?.[0] ?? null)}
          />
        </Field>
        {extracting && <div className="muted">Extracting text…</div>}
        {pickedFile && <div className="muted">From file: {pickedFile}</div>}
        <div className="row">
          <Field label="Title"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          {/* Set automatically from the chosen file; a teacher only touches this
              when pasting text or adding a link. (The old list carried an
              "exe (unsupported — try it)" testing artifact — removed.) */}
          <Field label="Type" hint={pickedFile ? "Set from the file you chose." : `Supported: ${FILE_TYPES.join(", ")}, media & images`}>
            <select className="select" value={fileType} onChange={(e) => setFileType(e.target.value)}>
              {FILE_TYPES.map((t) => <option key={t} value={t}>{t === "link" ? "link (URL)" : t}</option>)}
            </select>
          </Field>
        </div>
        {fileType === "link" ? (
          <Field label="URL" hint="The link goes through the same governance pipeline as a file: scan, classify, attest rights, approve.">
            <input className="input" type="url" placeholder="https://…" value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
        ) : (
          <Field label="Content" hint="Headings (lines starting with #) become groundable sections — more sections support more assessment questions.">
            <textarea className="input" style={{ minHeight: 120, fontFamily: "monospace", fontSize: 13 }} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
        )}
        <Button variant="primary" onClick={upload} disabled={busy === "upload" || !title.trim() || !text.trim()}>
          {busy === "upload" ? "Uploading…" : "Upload"}
        </Button>
      </Card>

      <Card>
        <div className="card__head"><h2 className="section">Your library {rows ? `— ${rows.filter((x) => x.mine).length}` : ""}</h2></div>
        {!rows ? <div className="muted">Loading…</div>
          : rows.filter((x) => x.mine).length === 0 ? <div className="muted">No material yet — upload something above to get started.</div>
          : (
            <ul className="people">
              {rows.filter((x) => x.mine).map((r) => {
                const state = itemState(r);
                const chip = STATE_CHIP[state];
                const action = nextAction(r);
                const expanded = open === r.id;
                const steps = checklist(r);
                const doneCount = steps.filter((s) => s.done).length;
                return (
                  <li key={r.id} style={{ display: "block", padding: 0, border: "1px solid var(--pf-border)", borderRadius: "var(--pf-radius-sm)" }}>
                    <button className="person" style={{ width: "100%", background: "none", border: "none", font: "inherit", cursor: "pointer", textAlign: "left" }}
                      onClick={() => setOpen(expanded ? null : r.id)} aria-expanded={expanded}>
                      <span className="person__avatar" aria-hidden="true">{(r.fileType ?? "?").slice(0, 3).toUpperCase()}</span>
                      <span><strong>{r.title}</strong></span>
                      <span className="person__meta">
                        {state === "broken" ? "needs a readable file" : `${doneCount} of ${steps.length} steps done`}
                      </span>
                      <span className="spacer" />
                      {/* Exactly one status — never a contradictory pair. */}
                      <Chip state={chip.state}>{chip.label}</Chip>
                    </button>
                    {expanded && state === "broken" && (
                      // Recovery card: nothing else is actionable until the file
                      // is readable, so nothing else is shown.
                      <div style={{ padding: "0 14px 14px" }}>
                        <Banner kind="warn">
                          We couldn't read this file, so it can't be approved or used to ground anything.
                          Upload a new version of the material — a text-based PDF, .docx, .txt or .md works best.
                        </Banner>
                      </div>
                    )}
                    {expanded && state !== "broken" && (
                      <div style={{ padding: "0 14px 14px" }}>
                        <ol style={{ listStyle: "none", padding: 0, margin: "0 0 12px", display: "flex", flexDirection: "column", gap: 6 }}>
                          {steps.map((s) => (
                            <li key={s.label} style={{ fontSize: 13, display: "flex", gap: 8, alignItems: "baseline" }}>
                              <span aria-hidden="true" style={{ color: s.done ? "var(--pf-brand)" : "var(--pf-slate)" }}>{s.done ? "✓" : "○"}</span>
                              <span>
                                <strong style={{ fontWeight: s.done ? 400 : 600 }}>{s.label}</strong>
                                {" — "}<span className="person__meta">{s.why}</span>
                              </span>
                            </li>
                          ))}
                        </ol>
                        {r.classification?.lowConfidence && (
                          <Banner kind="warn">The AI's subject suggestion is low-confidence — read the material below before confirming it.</Banner>
                        )}
                        {r.classification && r.classification.status !== "approved" && (
                          <p className="person__meta" style={{ margin: "0 0 10px" }}>
                            Suggested subject: {r.classification.subject} · {r.classification.topic}
                          </p>
                        )}
                        {r.approvalBlockReason && (
                          <p className="muted" style={{ margin: "0 0 10px" }}>Not ready to approve yet: {r.approvalBlockReason}.</p>
                        )}
                        <div className="btn-row" style={{ marginTop: 0 }}>
                          {/* Exactly one primary next action — the teacher never
                              has to work out the ordering themselves. */}
                          {action && (
                            <Button variant="primary" onClick={() => step(r.id, action.step)} disabled={busy === r.id}>
                              {busy === r.id ? "Working…" : action.label}
                            </Button>
                          )}
                          <Button variant="ghost" onClick={() => void togglePreview(r.id)} disabled={busy === r.id}>
                            {preview?.itemId === r.id ? "Hide material" : "Read material"}
                          </Button>
                          {!r.archived && (
                            <Button variant="ghost" disabled={busy === r.id} onClick={() => void archiveItem(r.id)}>
                              Archive
                            </Button>
                          )}
                        </div>

                        {(r.status === "approved" || r.status === "published") && skills?.signedOff && (
                          <div style={{ marginTop: 10 }}>
                            {/* An item's own subject may have no signed-off curriculum yet
                                (e.g. a Technology syllabus in a maths-only school). Say so
                                instead of quietly offering another subject's skills. */}
                            {missingCurriculumFor(r, skills) && (
                              <Banner kind="warn">
                                No {missingCurriculumFor(r, skills)} curriculum is signed off yet, so there is nowhere in
                                {" "}{missingCurriculumFor(r, skills)} to file this.
                                {r.officialSyllabus ? (
                                  <>
                                    {" "}Because this is tagged as the {r.officialSyllabus.subject} syllabus, you can draft one from it:{" "}
                                    <Button onClick={() => void draftCurriculum(r.id)} disabled={busy === r.id}>
                                      {busy === r.id ? "Drafting…" : "Draft curriculum from this syllabus"}
                                    </Button>
                                  </>
                                ) : (
                                  " Tag it as that subject's official syllabus under More options, then you can draft a curriculum from it."
                                )}
                              </Banner>
                            )}
                            {/* #19 — file it against the SUBJECT, which is what a
                                teacher actually knows when they upload something:
                                "this is Year 8 Technology". Material filed here
                                grounds every concept beneath it, so a curriculum
                                with 85 concepts doesn't demand 85 decisions.
                                Narrowing to a single concept is a refinement, and
                                lives under More options.

                                Only shown while mapping is the outstanding step:
                                once the material is linked to the curriculum this
                                form is finished business, not something to re-open
                                a filed document for. */}
                            {r.mappedNodeIds.length === 0 ? (
                              <>
                                <div className="row">
                                  <SubjectPicker skills={skills} value={mapSubject} onChange={setMapSubject} idPrefix={`map-${r.id}`}
                                    hint="Which curriculum this material belongs to. It will ground every concept in that subject." />
                                </div>
                                <Button onClick={() => map(r.id, mapSubject, () => setMapSubject(""))} disabled={busy === r.id || !mapSubject}>
                                  Map to this subject
                                </Button>
                              </>
                            ) : (
                              <p className="person__meta" style={{ margin: 0 }}>
                                Filed under {detail?.mappings.length
                                  ? detail.mappings.map((m) => m.chain.at(-1) ?? m.nodeId).join(", ")
                                  : `${r.mappedNodeIds.length} place${r.mappedNodeIds.length === 1 ? "" : "s"} in the curriculum`}
                                {" "}— ready to ground lessons and assessments.
                              </p>
                            )}
                          </div>
                        )}

                        {preview?.itemId === r.id && (
                          <div style={{ marginTop: 12, borderTop: "1px solid var(--pf-border)", paddingTop: 12 }}>
                            {preview.sections.length === 0 ? (
                              <p className="muted">No text has been extracted from this file yet.</p>
                            ) : preview.sections.map((s, i) => (
                              <div key={i} style={{ marginBottom: 12 }}>
                                <h4 style={{ fontSize: 13, margin: "0 0 3px" }}>{s.heading}</h4>
                                <p style={{ fontSize: 13, margin: 0, whiteSpace: "pre-wrap" }}>{s.text}</p>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Advanced controls stay out of the way until asked for:
                            the default card is status, checklist, one button. */}
                        <div className="btn-row" style={{ marginTop: 10 }}>
                          <button className="linkish" onClick={() => setShowAdvanced(!showAdvanced)} aria-expanded={showAdvanced}>
                            {showAdvanced ? "Hide options" : "More options (versions, sharing, official syllabus, mapping overrides)"}
                          </button>
                        </div>

                        {showAdvanced && detail && (
                          <div style={{ marginTop: 4, borderTop: "1px solid var(--pf-border)", paddingTop: 12 }}>
                            {/* The optional refinement (#19). Filing at subject level
                                grounds everything beneath it; naming a concept
                                NARROWS what that concept is taught from to this
                                material alone. Worth doing for a chapter that
                                really only covers one thing — and worth not doing
                                by default, which is why it lives here. */}
                            {(r.status === "approved" || r.status === "published") && skills?.signedOff && (
                              <div style={{ marginBottom: 12 }}>
                                <div className="row">
                                  <SkillPicker skills={skills} value={mapNode} onChange={setMapNode} idPrefix={`addmap-${r.id}`}
                                    label="Also map to a specific concept"
                                    hint="Optional. A concept with its own material is taught from that material rather than everything filed under the subject." />
                                </div>
                                <Button onClick={() => map(r.id, mapNode, () => setMapNode(""))} disabled={busy === r.id || !mapNode}>Add mapping</Button>
                              </div>
                            )}
                            <p className="person__meta" style={{ margin: "0 0 6px" }}>
                              Versions: {detail.versions.map((v) => `v${v.versionNumber}${v.current ? " (current)" : ""}`).join(" · ") || "—"}
                            </p>
                            {r.officialSyllabus ? (
                              <p className="person__meta" style={{ margin: "0 0 10px" }}>
                                <Chip state="approved">Official syllabus</Chip>{" "}
                                {r.officialSyllabus.subject} · Year {r.officialSyllabus.yearLevel} —{" "}
                                <a href={r.officialSyllabus.sourceUrl} target="_blank" rel="noreferrer">NESA source ↗</a>
                              </p>
                            ) : (
                              <div style={{ marginTop: 6, marginBottom: 10 }}>
                                <p className="person__meta" style={{ margin: "0 0 6px" }}>
                                  Mark as the official syllabus for a subject/year, so every teacher of that class can find it instead of re-uploading:
                                </p>
                                <div className="row">
                                  <Field label="Subject"><input className="input" value={syllabusSubject} onChange={(e) => setSyllabusSubject(e.target.value)} placeholder="Mathematics" /></Field>
                                  <Field label="Year level"><input className="input" type="number" min={1} max={12} value={syllabusYear} onChange={(e) => setSyllabusYear(e.target.value)} placeholder="8" /></Field>
                                </div>
                                <Field label="NESA source link" hint="Paste the NESA curriculum page you downloaded this from.">
                                  <input className="input" type="url" value={syllabusUrl} onChange={(e) => setSyllabusUrl(e.target.value)} placeholder="https://curriculum.nsw.edu.au/…" />
                                </Field>
                                <Button onClick={() => markSyllabus(r.id)} disabled={busy === r.id || !syllabusSubject.trim() || !syllabusYear || !syllabusUrl.trim()}>
                                  Mark as official syllabus
                                </Button>
                              </div>
                            )}
                            <div className="btn-row" style={{ marginTop: 6 }}>
                              <label className="person__meta" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                Sharing
                                <select className="select" style={{ width: "auto" }} defaultValue="" onChange={(e) => e.target.value && share(r.id, e.target.value)} aria-label="Sharing scope">
                                  <option value="" disabled>Change…</option>
                                  <option value="private">Private (only me)</option>
                                  {detail.classes.map((c) => <option key={c.id} value={`class:${c.id}`}>Class: {c.name}</option>)}
                                  {myDepartment && <option value={`department:${myDepartment}`}>Department: {myDepartment}</option>}
                                </select>
                              </label>
                            </div>
                            {detail.mappings.length > 0 && (
                              <div style={{ marginTop: 10 }}>
                                <p className="person__meta" style={{ margin: "0 0 6px" }}>Skill mappings — overriding re-points this content everywhere it's used:</p>
                                <ul className="people">
                                  {detail.mappings.map((m) => (
                                    <li className="person" key={m.mappingId} style={{ flexWrap: "wrap" }}>
                                      <span style={{ fontSize: 12 }}>{m.chain.join(" → ")}</span>
                                      {m.overriddenFromNodeId && <Chip state="pending">overridden</Chip>}
                                      {m.flags.map((f) => <Chip key={f} state="draft">{f.replace(/_/g, " ")}</Chip>)}
                                      <span className="spacer" />
                                      {/* Grouped by subject → where it sits, so an override
                                          can't silently land in another subject's curriculum. */}
                                      <select className="select" style={{ width: "auto", maxWidth: 260 }} value={overrideNode} onChange={(e) => setOverrideNode(e.target.value)} aria-label="Override to skill">
                                        <option value="">Override to…</option>
                                        {overrideGroups.map((g) => (
                                          <optgroup key={g.label} label={g.label}>
                                            {g.nodes.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
                                          </optgroup>
                                        ))}
                                      </select>
                                      <Button onClick={() => override(m.mappingId, overrideNode)} disabled={!overrideNode}>Override</Button>
                                      <Button variant="ghost" onClick={() => void unmap(m.mappingId)}>Remove</Button>
                                    </li>
                                  ))}
                                </ul>
                                {remapPrompt && (
                                  <Banner kind="warn">
                                    Historical mastery data exists against the current skill. Remap it to the new skill, or keep it where it is?
                                    <span className="btn-row" style={{ marginTop: 8 }}>
                                      <Button variant="primary" onClick={() => override(remapPrompt.mappingId, remapPrompt.newNodeId, true)}>Remap history</Button>
                                      <Button onClick={() => override(remapPrompt.mappingId, remapPrompt.newNodeId, false)}>Keep history on the old skill</Button>
                                      <Button variant="ghost" onClick={() => setRemapPrompt(null)}>Cancel</Button>
                                    </span>
                                  </Banner>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
      </Card>

      {/* #18 — the shared library. Colleagues' material that reaches you through
          its share scope (your class, your department, or an official syllabus).
          Read-only by design: you can read it and it already works for you —
          approved shared material grounds your assessments and drafts and shows
          up when you attach material to work — but its governance, sharing and
          filing belong to its owner. */}
      {rows && rows.some((x) => !x.mine) && (
        <Card>
          <div className="card__head">
            <h2 className="section">Shared with you — {rows.filter((x) => !x.mine).length}</h2>
            <p className="muted">Material colleagues have shared with your class or department. Once approved by its owner, it grounds your assessments and drafts just like your own.</p>
          </div>
          <ul className="people">
            {rows.filter((x) => !x.mine).map((r) => {
              const ready = itemState(r) === "ready";
              const expanded = open === r.id;
              const provenance = r.officialSyllabus
                ? `Official ${r.officialSyllabus.subject} syllabus`
                : r.share.type === "class" ? `with class ${r.share.label}`
                : r.share.type === "department" ? `with ${r.share.label}`
                : "";
              return (
                <li key={r.id} style={{ display: "block", padding: 0, border: "1px solid var(--pf-border)", borderRadius: "var(--pf-radius-sm)" }}>
                  <button className="person" style={{ width: "100%", background: "none", border: "none", font: "inherit", cursor: "pointer", textAlign: "left" }}
                    onClick={() => setOpen(expanded ? null : r.id)} aria-expanded={expanded}>
                    <span className="person__avatar" aria-hidden="true">{(r.fileType ?? "?").slice(0, 3).toUpperCase()}</span>
                    <span><strong>{r.title}</strong></span>
                    <span className="person__meta">{r.ownerLabel}{provenance ? ` · ${provenance}` : ""}</span>
                    <span className="spacer" />
                    {/* One honest status. A shared item that isn't ready has
                        nothing for YOU to do — the pipeline is the owner's. */}
                    {ready ? <Chip state="approved">Ready to use</Chip> : <Chip state="draft">Not yet approved by owner</Chip>}
                  </button>
                  {expanded && (
                    <div style={{ padding: "0 14px 14px" }}>
                      {ready ? (
                        <p className="person__meta" style={{ margin: "0 0 10px" }}>
                          Approved by {r.ownerLabel}
                          {detail && detail.mappings.length > 0 && <> · filed under {[...new Set(detail.mappings.map((m) => m.chain.at(-1) ?? m.nodeId))].join(", ")}</>}
                          . It already grounds your assessments and lesson drafts, and you can attach it when assigning work — no copy needed.
                        </p>
                      ) : (
                        <p className="person__meta" style={{ margin: "0 0 10px" }}>
                          {r.ownerLabel} hasn't finished the approval steps yet, so it can't ground anything for anyone. You can read it below.
                        </p>
                      )}
                      <div className="btn-row" style={{ marginTop: 0 }}>
                        <Button variant="ghost" onClick={() => void togglePreview(r.id)}>
                          {preview?.itemId === r.id ? "Hide material" : "Read material"}
                        </Button>
                      </div>
                      {preview?.itemId === r.id && (
                        <div style={{ marginTop: 12, borderTop: "1px solid var(--pf-border)", paddingTop: 12 }}>
                          {preview.sections.length === 0 ? (
                            <p className="muted">No text has been extracted from this file yet.</p>
                          ) : preview.sections.map((s, i) => (
                            <div key={i} style={{ marginBottom: 12 }}>
                              <h4 style={{ fontSize: 13, margin: "0 0 3px" }}>{s.heading}</h4>
                              <p style={{ fontSize: 13, margin: 0, whiteSpace: "pre-wrap" }}>{s.text}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </PageShell>
  );
}
