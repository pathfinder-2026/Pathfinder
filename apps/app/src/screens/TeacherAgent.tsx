import { useCallback, useEffect, useState } from "react";
import { api, type AgentSuggestionRow, type Session, type SkillsResult, type SyllabusLookup } from "../api";
import { Banner, Button, Card, Chip, Field, PageShell } from "../components";
import { NotificationBell } from "../NotificationBell";
import { SkillMultiPicker } from "../SkillPicker";
import { Markdown } from "../Markdown";

/** NESA's real curriculum site (verified) — the generic fallback when no
 * syllabus is on file yet. Never a guessed subject/year-specific deep link;
 * only the uploader's own pasted link (stored alongside the document) is
 * ever shown once one exists. */
const NESA_CURRICULUM_SITE = "https://curriculum.nsw.edu.au/";

// Each kind says what it MAKES and what it NEEDS — the dropdown used to be
// bare nouns, and teachers couldn't tell what they'd get or why a draft came
// out thin (a syllabus grounds outcomes; rich lessons need teaching material).
const KINDS = [
  { value: "unit_sequence", label: "Unit sequence — a term plan, week by week", hint: "Makes a week-by-week plan for the term with checkpoints. Needs the term name and approved material for the concepts." },
  { value: "lesson_plan", label: "Lesson plan — one teachable lesson", hint: "Makes a full lesson: learning intentions, success criteria, timed sequence, resources, differentiation. Richest when actual teaching material (not just a syllabus) is filed for the concepts." },
  { value: "differentiation", label: "Differentiated activities — tiered to your class", hint: "Makes support/core/extension activities tiered to your class's real mastery data (aggregates only — no student names leave the school)." },
  { value: "parent_summary", label: "Parent progress summary — a draft message", hint: "Makes a plain-language progress summary for one student's parent. You review, edit and send it yourself." },
  { value: "feedback", label: "Student feedback — a draft note", hint: "Makes strengths-and-next-steps feedback for one student. Never auto-sent." },
] as const;
type Kind = (typeof KINDS)[number]["value"];

/**
 * TCH-13 — the Teacher Agent (FR-TAG-001..004). Every draft is grounded in
 * approved content or declined outright; grounding sources are always listed
 * (archived ones stay as labelled references); parent-comms/feedback drafts
 * persist unsent and are editable; behavioural observations are separated and
 * flagged for extra review.
 */
export function TeacherAgent({ session, displayName, onBack, onSignOut }: {
  session: Session; displayName: string; onBack: () => void; onSignOut: () => void;
}) {
  const [suggestions, setSuggestions] = useState<AgentSuggestionRow[] | null>(null);
  const [skills, setSkills] = useState<SkillsResult | null>(null);
  const [capacity, setCapacity] = useState<Record<string, number>>({});
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([]);
  const [students, setStudents] = useState<{ id: string; label: string }[]>([]);
  // Concepts are multi-select (#19): a lesson plan or a unit sequence normally
  // spans several, and one-at-a-time forced the teacher to stitch drafts together.
  const [form, setForm] = useState({ kind: "lesson_plan" as Kind, nodeIds: [] as string[], topic: "", term: "Term 1", classId: "", studentId: "", obsAcademic: "", obsBehavioural: "" });
  const [busy, setBusy] = useState(false);
  const [declined, setDeclined] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; content: string } | null>(null);
  const [openDraftId, setOpenDraftId] = useState<string | null>(null);
  const [savingToLibrary, setSavingToLibrary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Draft-from-official-syllabus (ADR-0035)
  const [syllabusSubject, setSyllabusSubject] = useState("");
  const [syllabusYear, setSyllabusYear] = useState("");
  const [syllabusLookup, setSyllabusLookup] = useState<SyllabusLookup | null>(null);
  const [syllabusTopic, setSyllabusTopic] = useState("");
  const [syllabusBusy, setSyllabusBusy] = useState(false);

  const load = useCallback(async () => {
    const [sug, sk, cs, cap] = await Promise.all([
      api.listAgentSuggestions(session), api.skills(session), api.teacherClasses(session), api.assessmentCapacity(session),
    ]);
    setSuggestions(sug); setSkills(sk); setClasses(cs);
    // The concepts a draft can actually ground on. This used to be derived here
    // from each item's own mappedNodeIds, which since #19 answers the wrong
    // question: material filed against the subject grounds every concept beneath
    // it, and none of those concepts appear in any item's mapping list. The
    // capacity endpoint applies the same nearest-ancestor rule the generator
    // does, so the picker greys out exactly what would decline.
    setCapacity(cap);
    if (cs.length > 0 && !form.classId) {
      setForm((f) => ({ ...f, classId: cs[0].id }));
      const st = await api.classStudents(session, cs[0].id);
      setStudents(st);
    }
  }, [session, form.classId]);
  useEffect(() => { void load().catch((e) => setError((e as Error).message)); }, [load]);

  const needsStudent = form.kind === "parent_summary" || form.kind === "feedback";
  const generate = async () => {
    setBusy(true); setError(null); setDeclined(null); setNotice(null);
    try {
      const observations = [
        ...(form.obsAcademic.trim() ? [{ category: "academic", text: form.obsAcademic.trim() }] : []),
        ...(form.obsBehavioural.trim() ? [{ category: "behavioural", text: form.obsBehavioural.trim() }] : []),
      ];
      const result = await api.agentGenerate(session, {
        kind: form.kind, nodeIds: form.nodeIds, topic: form.topic || undefined, term: form.term,
        classId: form.classId || undefined, studentId: form.studentId || undefined,
        observations: needsStudent ? observations : undefined,
      });
      if (result.status === "declined") setDeclined(result.message);
      else { setNotice("Draft created. It stays here unsent until you use it — nothing is auto-sent."); await load(); }
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const findSyllabus = async () => {
    const yearLevel = Number(syllabusYear);
    if (!syllabusSubject.trim() || !yearLevel) return;
    setError(null); setSyllabusBusy(true); setSyllabusTopic("");
    try { setSyllabusLookup(await api.getSyllabus(session, syllabusSubject.trim(), yearLevel)); }
    catch (e) { setError((e as Error).message); }
    finally { setSyllabusBusy(false); }
  };

  /** Draft straight from the chosen syllabus topic — reuses the same generate() flow below. */
  const draftFromSyllabus = async () => {
    if (!syllabusTopic) return;
    setForm((f) => ({ ...f, kind: "lesson_plan", nodeIds: [syllabusTopic] }));
    setBusy(true); setError(null); setDeclined(null); setNotice(null);
    try {
      const result = await api.agentGenerate(session, { kind: "lesson_plan", nodeIds: [syllabusTopic] });
      if (result.status === "declined") setDeclined(result.message);
      else { setNotice("Initial lesson drafted from the official syllabus — review it below before using it."); await load(); }
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const saveEdit = async () => {
    if (!editing) return;
    setError(null);
    try { await api.editAgentDraft(session, editing.id, editing.content); setEditing(null); await load(); }
    catch (e) { setError((e as Error).message); }
  };

  const deleteDraft = async (id: string) => {
    if (!window.confirm("Delete this draft? It hasn't been sent anywhere, so nothing else is affected.")) return;
    setError(null); setNotice(null);
    try { await api.deleteAgentDraft(session, id); setOpenDraftId(null); setNotice("Draft deleted."); await load(); }
    catch (e) { setError((e as Error).message); }
  };

  /**
   * Draft → library item, through the SAME governed pipeline as an upload:
   * the teacher walks it through approval in Content Studio, and only then can
   * it be assigned to a class, shared, or ground assessments. The draft's
   * markdown headings become the item's groundable sections.
   */
  const saveToLibrary = async (s: AgentSuggestionRow) => {
    setError(null); setNotice(null); setSavingToLibrary(s.id);
    try {
      const result = await api.uploadContent(session, { title: s.title, fileType: "md", text: s.content });
      if (result.status === "rejected") setError(`Couldn't save to library (${result.reason.replace(/_/g, " ")}): ${result.message}`);
      else setNotice("Saved to your library — open Content Studio to walk it through the approval steps, then it can be assigned, shared, and ground assessments.");
    } catch (e) { setError((e as Error).message); }
    finally { setSavingToLibrary(null); }
  };

  return (
    <PageShell topRight={<NotificationBell session={session} />} displayName={displayName} title="Teacher Agent" roleTag="Teacher" backLabel="Back to teacher home"
      onBack={onBack} onSignOut={onSignOut}
      lede="Drafts grounded strictly in your approved content — a request with no grounding is declined, never invented. Drafts persist unsent; you edit and send them yourself.">
      {error && <Banner kind="error">{error}</Banner>}
      {notice && <Banner kind="brand">{notice}</Banner>}
      {declined && <Banner kind="warn">{declined}</Banner>}

      <Card>
        <div className="card__head"><h2 className="section">Draft from the official syllabus</h2></div>
        <div className="row">
          <Field label="Subject" htmlFor="syl-subject"><input id="syl-subject" className="input" value={syllabusSubject} onChange={(e) => setSyllabusSubject(e.target.value)} placeholder="Mathematics" /></Field>
          <Field label="Year level" htmlFor="syl-year"><input id="syl-year" className="input" type="number" min={1} max={12} value={syllabusYear} onChange={(e) => setSyllabusYear(e.target.value)} placeholder="8" /></Field>
        </div>
        <Button onClick={findSyllabus} disabled={syllabusBusy || !syllabusSubject.trim() || !syllabusYear}>
          {syllabusBusy ? "Looking…" : "Find syllabus"}
        </Button>

        {syllabusLookup && !syllabusLookup.found && (
          <Banner kind="warn">
            No syllabus on file yet for {syllabusSubject} Year {syllabusYear}. Find the current one on{" "}
            <a href={NESA_CURRICULUM_SITE} target="_blank" rel="noreferrer">NESA's curriculum site ↗</a>, download it, then upload it in{" "}
            Content Studio and mark it as the official syllabus for this subject/year — after that, it's here for every teacher, not just you.
          </Banner>
        )}

        {syllabusLookup?.found && (
          <div style={{ marginTop: 10, border: "1px solid var(--pf-border)", borderRadius: 10, padding: 14 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <strong>{syllabusLookup.item.title}</strong>
              <Chip state="approved">Official syllabus</Chip>
              <span className="person__meta">on file as of {new Date(syllabusLookup.item.createdAt).toLocaleDateString()}</span>
            </div>
            <p className="person__meta" style={{ margin: "6px 0" }}>
              <a href={syllabusLookup.item.officialSyllabus?.sourceUrl} target="_blank" rel="noreferrer">View latest on NESA ↗</a>
              {" — check it's still current, and re-upload in Content Studio if NESA has since revised it."}
            </p>
            {syllabusLookup.topics.length === 0 ? (
              <Banner kind="warn">This syllabus hasn't been mapped to any topics yet — map it in Content Studio before drafting from it.</Banner>
            ) : (
              <>
                <Field label="Topic from this syllabus" htmlFor="syl-topic">
                  <select id="syl-topic" className="select" value={syllabusTopic} onChange={(e) => setSyllabusTopic(e.target.value)}>
                    <option value="">Choose…</option>
                    {syllabusLookup.topics.map((t) => <option key={t.nodeId} value={t.nodeId}>{t.chain.join(" → ")}</option>)}
                  </select>
                </Field>
                <Button variant="primary" onClick={draftFromSyllabus} disabled={busy || !syllabusTopic}>
                  {busy ? "Drafting…" : "Draft initial lesson"}
                </Button>
              </>
            )}
          </div>
        )}
      </Card>

      <Card>
        <div className="card__head"><h2 className="section">Draft something</h2></div>
        {skills && !skills.signedOff && <Banner kind="warn">The skill graph isn't signed off yet — agent drafts ground on a signed-off skill.</Banner>}
        <div className="row">
          <Field label="Draft type" htmlFor="ag-kind" hint={KINDS.find((k) => k.value === form.kind)?.hint}>
            <select id="ag-kind" className="select" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as Kind })}>
              {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
          </Field>
          <SkillMultiPicker
            skills={skills} values={form.nodeIds} idPrefix="ag"
            // Same ready/not-ready rule as before, now over the real hierarchy:
            // a concept with nothing grounding it would only ever decline.
            capacity={capacity}
            onChange={(nodeIds) => setForm((f) => ({ ...f, nodeIds }))}
            hint="Tick every concept the draft should cover. Only concepts with approved Content Studio material behind them can ground one — file more content to unlock the rest."
          />
        </div>
        <div className="row">
          <Field label="Topic (optional)" htmlFor="ag-topic"><input id="ag-topic" className="input" value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} /></Field>
          {form.kind === "unit_sequence" && <Field label="Term" htmlFor="ag-term"><input id="ag-term" className="input" value={form.term} onChange={(e) => setForm({ ...form, term: e.target.value })} /></Field>}
          {form.kind === "differentiation" && (
            <Field label="Class" htmlFor="ag-class">
              <select id="ag-class" className="select" value={form.classId} onChange={(e) => setForm({ ...form, classId: e.target.value })}>
                {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
          )}
          {needsStudent && (
            <Field label="Student" htmlFor="ag-student">
              <select id="ag-student" className="select" value={form.studentId} onChange={(e) => setForm({ ...form, studentId: e.target.value })}>
                <option value="">Choose…</option>
                {students.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </Field>
          )}
        </div>
        {needsStudent && (
          <>
            <Field label="Academic observation (optional)" htmlFor="ag-obs-a">
              <input id="ag-obs-a" className="input" value={form.obsAcademic} onChange={(e) => setForm({ ...form, obsAcademic: e.target.value })} />
            </Field>
            <Field label="Behavioural/social observation (optional)" hint="Kept separate from the academic body and flagged for your extra review — never blended in." htmlFor="ag-obs-b">
              <input id="ag-obs-b" className="input" value={form.obsBehavioural} onChange={(e) => setForm({ ...form, obsBehavioural: e.target.value })} />
            </Field>
          </>
        )}
        <Button variant="primary" onClick={generate} disabled={busy || form.nodeIds.length === 0 || (needsStudent && !form.studentId)}>
          {busy ? "Drafting…" : "Draft it"}
        </Button>
      </Card>

      <Card>
        <div className="card__head"><h2 className="section">Your drafts {suggestions ? `— ${suggestions.length}` : ""}</h2><p className="muted">Open a draft to read it as a document, edit it in your own words, or save it into your library as teaching material. Nothing here is ever sent automatically.</p></div>
        {suggestions && suggestions.length === 0 && <Banner kind="brand">No drafts yet.</Banner>}
        {(suggestions ?? []).map((s) => {
          const expanded = openDraftId === s.id;
          const kindLabel = KINDS.find((k) => k.value === s.kind)?.label.split(" — ")[0] ?? s.kind.replace(/_/g, " ");
          return (
            <div key={s.id} style={{ border: "1px solid var(--pf-border)", borderRadius: 10, marginBottom: 10, overflow: "hidden" }}>
              {/* Collapsed by default: eight drafts used to mean eight full
                  documents end to end — the page was unreadable. */}
              <button className="person" style={{ width: "100%", background: "none", border: "none", font: "inherit", cursor: "pointer", textAlign: "left", padding: 14 }}
                onClick={() => { setOpenDraftId(expanded ? null : s.id); setEditing(null); }} aria-expanded={expanded}>
                <span aria-hidden="true" style={{ color: "var(--pf-slate)", fontSize: 12 }}>{expanded ? "▾" : "▸"}</span>
                <strong>{s.title}</strong>
                <span className="person__meta">{kindLabel} · {new Date(s.createdAt).toLocaleDateString()}</span>
                {s.edited && <Chip state="pending">Edited by you</Chip>}
                {s.requiresExtraReview && <Chip state="draft">Extra review needed</Chip>}
                <span className="spacer" />
                <Chip state="draft">Draft — never auto-sent</Chip>
              </button>
              {expanded && (
                <div style={{ padding: "0 14px 14px" }}>
                  {!s.personalised && s.personalisationNote && <Banner kind="warn">{s.personalisationNote}</Banner>}
                  {editing?.id === s.id ? (
                    <div style={{ marginTop: 4 }}>
                      <textarea className="input" style={{ minHeight: 260, fontFamily: "monospace", fontSize: 13 }} value={editing.content}
                        onChange={(e) => setEditing({ id: s.id, content: e.target.value })} aria-label="Edit draft content" />
                      <div className="btn-row">
                        <Button variant="primary" onClick={saveEdit}>Save</Button>
                        <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ marginTop: 4, border: "1px solid var(--pf-border)", borderRadius: 8, padding: "14px 16px", background: "var(--pf-card)" }}>
                      <Markdown text={s.content} />
                    </div>
                  )}
                  {s.sensitiveSections.length > 0 && (
                    <div style={{ marginTop: 10 }}>
                      <Banner kind="warn">Behavioural/social observations — separated from the academic body, flagged for your review:</Banner>
                      <ul className="people">
                        {s.sensitiveSections.map((sec, i) => (
                          <li className="person" key={i}><span className="person__meta">{sec.category}</span><span>{sec.text}</span></li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="legend" style={{ marginTop: 10 }}>
                    <span className="person__meta">Grounded in:</span>
                    {s.grounding.map((g, i) => (
                      <Chip key={i} state={g.archived ? "pending" : "approved"}>{g.title}{g.archived ? " (archived)" : ""}</Chip>
                    ))}
                  </div>
                  {editing?.id !== s.id && (
                    <div className="btn-row" style={{ marginTop: 12 }}>
                      <Button variant="ghost" onClick={() => setEditing({ id: s.id, content: s.content })}>Edit</Button>
                      {/* The path from "good draft" to actual teaching material:
                          it becomes a library item and goes through the teacher's
                          own approval steps like anything else — after which it's
                          assignable, shareable, and grounds future assessments. */}
                      <Button onClick={() => void saveToLibrary(s)} disabled={savingToLibrary === s.id}>
                        {savingToLibrary === s.id ? "Saving…" : "Save to my library"}
                      </Button>
                      <Button variant="ghost" onClick={() => void deleteDraft(s.id)}>Delete</Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </Card>
    </PageShell>
  );
}
