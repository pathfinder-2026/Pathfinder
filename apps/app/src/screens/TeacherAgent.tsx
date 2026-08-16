import { useCallback, useEffect, useState } from "react";
import { api, type AgentSuggestionRow, type Session, type SkillsResult, type SyllabusLookup } from "../api";
import { Banner, Button, Card, Chip, Field, PageShell } from "../components";
import { SkillPicker } from "../SkillPicker";

/** NESA's real curriculum site (verified) — the generic fallback when no
 * syllabus is on file yet. Never a guessed subject/year-specific deep link;
 * only the uploader's own pasted link (stored alongside the document) is
 * ever shown once one exists. */
const NESA_CURRICULUM_SITE = "https://curriculum.nsw.edu.au/";

const KINDS = [
  { value: "unit_sequence", label: "Unit sequence" },
  { value: "lesson_plan", label: "Lesson plan" },
  { value: "differentiation", label: "Differentiated activities" },
  { value: "parent_summary", label: "Parent progress summary" },
  { value: "feedback", label: "Student feedback" },
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
  const [groundedNodeIds, setGroundedNodeIds] = useState<Set<string>>(new Set());
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([]);
  const [students, setStudents] = useState<{ id: string; label: string }[]>([]);
  const [form, setForm] = useState({ kind: "lesson_plan" as Kind, nodeId: "", topic: "", term: "Term 1", classId: "", studentId: "", obsAcademic: "", obsBehavioural: "" });
  const [busy, setBusy] = useState(false);
  const [declined, setDeclined] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; content: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Draft-from-official-syllabus (ADR-0035)
  const [syllabusSubject, setSyllabusSubject] = useState("");
  const [syllabusYear, setSyllabusYear] = useState("");
  const [syllabusLookup, setSyllabusLookup] = useState<SyllabusLookup | null>(null);
  const [syllabusTopic, setSyllabusTopic] = useState("");
  const [syllabusBusy, setSyllabusBusy] = useState(false);

  const load = useCallback(async () => {
    const [sug, sk, cs, content] = await Promise.all([
      api.listAgentSuggestions(session), api.skills(session), api.teacherClasses(session), api.listContent(session),
    ]);
    setSuggestions(sug); setSkills(sk); setClasses(cs);
    // The skills a draft can actually ground on: nodes with APPROVED mapped
    // content (Content Studio state drives this — an unmapped skill would only
    // ever produce an honest decline).
    setGroundedNodeIds(new Set(content.filter((c) => c.status === "approved" && !c.archived).flatMap((c) => c.mappedNodeIds)));
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
        kind: form.kind, nodeId: form.nodeId, topic: form.topic || undefined, term: form.term,
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
    setForm((f) => ({ ...f, kind: "lesson_plan", nodeId: syllabusTopic }));
    setBusy(true); setError(null); setDeclined(null); setNotice(null);
    try {
      const result = await api.agentGenerate(session, { kind: "lesson_plan", nodeId: syllabusTopic });
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

  return (
    <PageShell displayName={displayName} title="Teacher Agent" roleTag="Teacher" backLabel="Back to teacher home"
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
          <Field label="Draft type" htmlFor="ag-kind">
            <select id="ag-kind" className="select" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as Kind })}>
              {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
          </Field>
          <SkillPicker
            skills={skills} value={form.nodeId} idPrefix="ag"
            // Same ready/not-ready rule as before, now over the real hierarchy:
            // a skill with no approved mapped content would only ever decline.
            capacity={Object.fromEntries([...groundedNodeIds].map((id) => [id, 1]))}
            onChange={(nodeId) => setForm((f) => ({ ...f, nodeId }))}
            hint="Only skills with approved Content Studio material can ground a draft — approve and map more content to unlock the rest."
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
        <Button variant="primary" onClick={generate} disabled={busy || !form.nodeId || (needsStudent && !form.studentId)}>
          {busy ? "Drafting…" : "Draft it"}
        </Button>
      </Card>

      <Card>
        <div className="card__head"><h2 className="section">Your drafts</h2><p className="muted">Every draft lists all its grounding sources. Nothing here is ever sent automatically.</p></div>
        {suggestions && suggestions.length === 0 && <Banner kind="brand">No drafts yet.</Banner>}
        {(suggestions ?? []).map((s) => (
          <div key={s.id} style={{ border: "1px solid var(--pf-border)", borderRadius: 10, padding: 14, marginBottom: 12 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <strong>{s.title}</strong>
              <Chip state="draft">Draft — never auto-sent</Chip>
              {s.edited && <Chip state="pending">Edited</Chip>}
              {s.requiresExtraReview && <Chip state="draft">Extra review needed</Chip>}
              <span className="spacer" />
              <button className="linkish" onClick={() => setEditing({ id: s.id, content: s.content })}>Edit</button>
            </div>
            {!s.personalised && s.personalisationNote && <Banner kind="warn">{s.personalisationNote}</Banner>}
            {editing?.id === s.id ? (
              <div style={{ marginTop: 10 }}>
                <textarea className="input" style={{ minHeight: 120 }} value={editing.content} onChange={(e) => setEditing({ id: s.id, content: e.target.value })} aria-label="Edit draft content" />
                <div className="btn-row">
                  <Button variant="primary" onClick={saveEdit}>Save</Button>
                  <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <p style={{ fontSize: 13, whiteSpace: "pre-wrap", margin: "10px 0 0" }}>{s.content}</p>
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
          </div>
        ))}
      </Card>
    </PageShell>
  );
}
