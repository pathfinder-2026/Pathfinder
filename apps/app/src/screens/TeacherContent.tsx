import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type ContentRow, type MappingRow, type Session, type SkillsResult, type UploadResult } from "../api";
import { Banner, Button, Card, Chip, Field, PageShell, type GovState } from "../components";

const FILE_TYPES = ["pdf", "doc", "docx", "ppt", "pptx", "txt", "md", "link"] as const;

function govChip(status: string): { state: GovState; label: string } {
  if (status === "approved" || status === "published") return { state: "approved", label: "Approved" };
  return { state: "draft", label: "Pending approval" };
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
  const [skills, setSkills] = useState<SkillsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // itemId (or "upload") in flight
  const [open, setOpen] = useState<string | null>(null); // expanded item
  const [mapNode, setMapNode] = useState("");
  // TCH-2/3 detail state for the expanded item
  const [detail, setDetail] = useState<{
    versions: Awaited<ReturnType<typeof api.contentVersions>>;
    mappings: MappingRow[];
    classes: { id: string; name: string }[];
  } | null>(null);
  const [overrideNode, setOverrideNode] = useState("");
  const [remapPrompt, setRemapPrompt] = useState<{ mappingId: string; newNodeId: string } | null>(null);
  // Official syllabus tagging (ADR-0035) — subject/year/NESA-link form for the expanded item
  const [syllabusSubject, setSyllabusSubject] = useState("");
  const [syllabusYear, setSyllabusYear] = useState("");
  const [syllabusUrl, setSyllabusUrl] = useState("");

  // Upload form
  const [title, setTitle] = useState("");
  const [fileType, setFileType] = useState<string>("pdf");
  const [text, setText] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [content, sk] = await Promise.all([api.listContent(session), api.skills(session)]);
      setRows(content); setSkills(sk);
    } catch (e) { setError((e as Error).message); }
  }, [session]);

  useEffect(() => { void refresh(); }, [refresh]);

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
        setTitle(""); setText("");
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

  const map = async (itemId: string) => {
    if (!mapNode) return;
    setError(null); setBusy(itemId);
    try { await api.mapContent(session, itemId, [mapNode]); setMapNode(""); await refresh(); }
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

  const nodeOptions = skills?.signedOff ? skills.nodes.filter((n) => n.type === "subskill" || n.type === "skill") : [];

  return (
    <PageShell displayName={displayName} title="Content Studio" roleTag="Teacher" backLabel="Back to teacher home"
      onBack={onBack} onSignOut={onSignOut}
      lede="Only material you explicitly approve joins the pool that grounds assessments and suggestions. Each governance step below is yours to take — nothing is approved automatically.">
      {error && <Banner kind="error">{error}</Banner>}
      {notice && <Banner kind="brand">{notice}</Banner>}
      {skills && !skills.signedOff && (
        <Banner kind="warn">The skill graph isn't signed off yet — approved content can't be mapped until your administrator signs it off.</Banner>
      )}

      <Card>
        <div className="card__head"><h2 className="section">Upload material</h2></div>
        <div className="row">
          <Field label="Title"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <Field label="Type" hint={`Supported: ${FILE_TYPES.join(", ")}, media & images`}>
            <select className="select" value={fileType} onChange={(e) => setFileType(e.target.value)}>
              {FILE_TYPES.map((t) => <option key={t} value={t}>{t === "link" ? "link (URL)" : t}</option>)}
              <option value="exe">exe (unsupported — try it)</option>
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
        <div className="card__head"><h2 className="section">Library {rows ? `— ${rows.length}` : ""}</h2></div>
        {!rows ? <div className="muted">Loading…</div>
          : rows.length === 0 ? <div className="muted">No material yet — upload something above to get started.</div>
          : (
            <ul className="people">
              {rows.map((r) => {
                const chip = govChip(r.status);
                const action = nextAction(r);
                const expanded = open === r.id;
                return (
                  <li key={r.id} style={{ display: "block", padding: 0, border: "1px solid var(--pf-border)", borderRadius: "var(--pf-radius-sm)" }}>
                    <button className="person" style={{ width: "100%", background: "none", border: "none", font: "inherit", cursor: "pointer", textAlign: "left" }}
                      onClick={() => setOpen(expanded ? null : r.id)} aria-expanded={expanded}>
                      <span className="person__avatar" aria-hidden="true">{(r.fileType ?? "?").slice(0, 3).toUpperCase()}</span>
                      <span><strong>{r.title}</strong></span>
                      <span className="person__meta">{r.mappedNodeIds.length > 0 ? `${r.mappedNodeIds.length} skill${r.mappedNodeIds.length > 1 ? "s" : ""} mapped` : "not mapped"}</span>
                      <span className="spacer" />
                      {r.ingestionStatus === "failed" && <Chip state="pending">Processing failed</Chip>}
                      <Chip state={chip.state}>{chip.label}</Chip>
                    </button>
                    {expanded && (
                      <div style={{ padding: "0 14px 14px" }}>
                        <div className="legend" style={{ marginBottom: 10 }}>
                          <Chip state={r.ingestionStatus === "ingested" ? "approved" : "draft"}>Ingestion: {r.ingestionStatus ?? "—"}</Chip>
                          <Chip state={r.classification?.status === "approved" ? "approved" : "draft"}>
                            Classification: {r.classification ? `${r.classification.subject} · ${r.classification.topic} (${r.classification.status})` : "not yet suggested"}
                          </Chip>
                          <Chip state={r.rightsAttested ? "approved" : "draft"}>Rights: {r.rightsAttested ? "attested" : "not attested"}</Chip>
                        </div>
                        {r.classification?.lowConfidence && (
                          <Banner kind="warn">The AI classification is low-confidence — review it carefully before approving.</Banner>
                        )}
                        {r.approvalBlockReason && (
                          <p className="muted" style={{ margin: "0 0 10px" }}>Approval blocked: {r.approvalBlockReason}.</p>
                        )}
                        <div className="btn-row" style={{ marginTop: 0 }}>
                          {action && (
                            <Button variant={action.governance ? "primary" : "default"} onClick={() => step(r.id, action.step)} disabled={busy === r.id}>
                              {busy === r.id ? "Working…" : action.label}
                            </Button>
                          )}
                          {!action && r.status !== "approved" && r.status !== "published" && r.ingestionStatus === "failed" && (
                            <span className="muted">Processing failed — fix the source material and upload a new version.</span>
                          )}
                          {(r.status === "approved" || r.status === "published") && skills?.signedOff && (
                            <>
                              <select className="select" style={{ maxWidth: 320 }} value={mapNode} onChange={(e) => setMapNode(e.target.value)} aria-label="Skill to map">
                                <option value="">Map to a skill…</option>
                                {nodeOptions.map((n) => <option key={n.id} value={n.id}>{n.label}{n.code ? ` (${n.code})` : ""}</option>)}
                              </select>
                              <Button onClick={() => map(r.id)} disabled={busy === r.id || !mapNode}>Map skill</Button>
                            </>
                          )}
                        </div>

                        {detail && (
                          <div style={{ marginTop: 14, borderTop: "1px solid var(--pf-border)", paddingTop: 12 }}>
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
                                  <option value="department:Mathematics">Department: Mathematics</option>
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
                                      <select className="select" style={{ width: "auto", maxWidth: 220 }} value={overrideNode} onChange={(e) => setOverrideNode(e.target.value)} aria-label="Override to skill">
                                        <option value="">Override to…</option>
                                        {nodeOptions.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
                                      </select>
                                      <Button onClick={() => override(m.mappingId, overrideNode)} disabled={!overrideNode}>Override</Button>
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
    </PageShell>
  );
}
