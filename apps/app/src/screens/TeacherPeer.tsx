import { useCallback, useEffect, useState } from "react";
import { api, type PeerResults, type PeerTestRow, type Session, type SkillsResult } from "../api";
import { Banner, Button, Card, Chip, Field, PageShell } from "../components";
import type { GovState } from "../components";
import { SkillPicker } from "../SkillPicker";

const STATUS_CHIP: Record<PeerTestRow["status"], GovState> = {
  draft: "draft", scheduled: "pending", launched: "approved", closed: "locked", cancelled: "pending",
};

/**
 * TCH-10..12 — the peer suite (FR-PEER-001..005). Computed benchmarks follow
 * publish-or-withhold: figures are locked-computed (never editable here), the
 * default is withheld, and the only way to change a result is the logged
 * correction path. Peer reviews are moderated approve/reject — never rewritten.
 */
export function TeacherPeer({ session, displayName, onBack, onSignOut }: {
  session: Session; displayName: string; onBack: () => void; onSignOut: () => void;
}) {
  const [tests, setTests] = useState<PeerTestRow[] | null>(null);
  const [skills, setSkills] = useState<SkillsResult | null>(null);
  const [capacity, setCapacity] = useState<Record<string, number>>({});
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([]);
  const [students, setStudents] = useState<{ id: string; label: string }[]>([]);
  const [form, setForm] = useState({ title: "", nodeId: "", questionCount: 5, classId: "", anonymity: "named" as "named" | "anonymous", accommodateId: "" });
  const [cohort, setCohort] = useState<string[]>([]);
  const [selected, setSelected] = useState<PeerTestRow | null>(null);
  const [results, setResults] = useState<PeerResults | null>(null);
  const [reviews, setReviews] = useState<{ anonymityRisk: boolean; reviews: { id: string; text: string }[] } | null>(null);
  const [correction, setCorrection] = useState({ studentId: "", score: "", reason: "" });
  const [grade, setGrade] = useState({ studentId: "", score: "" });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    // Peer tests ground on the same approved+mapped pool as assessments, so the
    // same capacity map keeps un-groundable skills out of the builder.
    const [t, sk, cs, cap] = await Promise.all([
      api.listPeerTests(session), api.skills(session), api.teacherClasses(session), api.assessmentCapacity(session),
    ]);
    setTests(t); setSkills(sk); setClasses(cs); setCapacity(cap);
    if (cs.length > 0 && !form.classId) setForm((f) => ({ ...f, classId: cs[0].id }));
  }, [session, form.classId]);
  useEffect(() => { void load().catch((e) => setError((e as Error).message)); }, [load]);

  useEffect(() => {
    if (!form.classId) return;
    api.classStudents(session, form.classId).then((s) => { setStudents(s); setCohort([]); }).catch((e) => setError((e as Error).message));
  }, [session, form.classId]);

  const openTest = useCallback(async (t: PeerTestRow) => {
    setSelected(t); setResults(null); setReviews(null); setError(null); setNotice(null);
    try {
      const [r, rv] = await Promise.all([api.peerResults(session, t.id), api.peerPendingReviews(session, t.id)]);
      setResults(r); setReviews(rv);
    } catch (e) { setError((e as Error).message); }
  }, [session]);

  const act = async (fn: () => Promise<string | void>) => {
    setError(null); setNotice(null);
    try {
      const msg = await fn();
      if (msg) setNotice(msg);
      const t = await api.listPeerTests(session);
      setTests(t);
      if (selected) {
        const fresh = t.find((x) => x.id === selected.id) ?? null;
        setSelected(fresh);
        if (fresh) await openTest(fresh);
      }
    } catch (e) { setError((e as Error).message); }
  };

  const build = () => act(async () => {
    const built = await api.buildPeerTest(session, {
      title: form.title, nodeId: form.nodeId, questionCount: form.questionCount,
      cohort, anonymity: form.anonymity,
      accommodations: form.accommodateId ? [{ studentId: form.accommodateId, kind: "extra-time" }] : [],
    });
    setForm((f) => ({ ...f, title: "", accommodateId: "" })); setCohort([]);
    return built.warnings.length > 0
      ? `Draft created with ${built.warnings.length} warning(s) — review them below before launching.`
      : "Draft peer test created.";
  });

  const bandText: Record<string, string> = { above: "above average", at: "at average", below: "below average" };

  return (
    <PageShell displayName={displayName} title="Peer testing" roleTag="Teacher" backLabel="Back to teacher home"
      onBack={onBack} onSignOut={onSignOut}
      lede="Build peer tests, deliver them to a cohort, and decide what students see. Computed figures are locked — you publish or withhold them, and corrections go through a logged path.">
      {error && <Banner kind="error">{error}</Banner>}
      {notice && <Banner kind="brand">{notice}</Banner>}

      <Card>
        <div className="card__head"><h2 className="section">New peer test</h2></div>
        {skills && !skills.signedOff && <Banner kind="warn">The skill graph isn't signed off yet — peer tests need a signed-off skill to ground on.</Banner>}
        <Field label="Title" htmlFor="pt-title"><input id="pt-title" className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
        <div className="row">
          <SkillPicker
            skills={skills} value={form.nodeId} capacity={capacity} countNoun="questions" idPrefix="pt"
            onChange={(nodeId) => setForm((f) => ({ ...f, nodeId }))}
            hint="Only skills with approved, mapped material can ground a peer test."
          />
        </div>
        <div className="row">
          <Field label="Questions" htmlFor="pt-count" hint={form.nodeId
            ? `Your approved material can ground up to ${capacity[form.nodeId] ?? 0} question${(capacity[form.nodeId] ?? 0) === 1 ? "" : "s"} for this skill.`
            : undefined}>
            <input id="pt-count" className="input" type="number" min={1} value={form.questionCount} onChange={(e) => setForm({ ...form, questionCount: Number(e.target.value) })} />
          </Field>
          <Field label="Anonymity" htmlFor="pt-anon" hint="In a small anonymous cohort, an accommodation can risk identifying a student — you'll be warned, never silently overridden.">
            <select id="pt-anon" className="select" value={form.anonymity} onChange={(e) => setForm({ ...form, anonymity: e.target.value as "named" | "anonymous" })}>
              <option value="named">Named</option>
              <option value="anonymous">Anonymous</option>
            </select>
          </Field>
        </div>
        <div className="row">
          <Field label="Class" htmlFor="pt-class">
            <select id="pt-class" className="select" value={form.classId} onChange={(e) => setForm({ ...form, classId: e.target.value })}>
              {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Accommodation (extra time)" htmlFor="pt-acc">
            <select id="pt-acc" className="select" value={form.accommodateId} onChange={(e) => setForm({ ...form, accommodateId: e.target.value })}>
              <option value="">None</option>
              {students.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </Field>
        </div>
        <Field label={`Cohort — ${cohort.length} of ${students.length} selected`}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {students.map((s) => (
              <label key={s.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, border: "1px solid var(--pf-border)", borderRadius: 999, padding: "4px 10px" }}>
                <input type="checkbox" checked={cohort.includes(s.id)} onChange={() => setCohort((c) => c.includes(s.id) ? c.filter((x) => x !== s.id) : [...c, s.id])} aria-label={`Include ${s.label}`} />
                {s.label}
              </label>
            ))}
            {students.length === 0 && <span className="muted">No students in this class yet.</span>}
          </div>
        </Field>
        <Button variant="primary" onClick={build} disabled={!form.title.trim() || !form.nodeId || cohort.length === 0}>Create draft</Button>
      </Card>

      <Card>
        <div className="card__head"><h2 className="section">Peer tests</h2><p className="muted">Cohorts lock at launch. Cancelling is only possible before launch and removes every placement cleanly.</p></div>
        {tests && tests.length === 0 && <Banner kind="brand">No peer tests yet — create a draft above.</Banner>}
        <ul className="people">
          {(tests ?? []).map((t) => (
            <li className="person" key={t.id} style={{ flexWrap: "wrap", gap: 10 }}>
              <button className="linkish" onClick={() => openTest(t)}><strong>{t.title}</strong></button>
              <Chip state={STATUS_CHIP[t.status]}>{t.status}</Chip>
              <span className="person__meta">{t.cohortSize} students · {t.questionCount} questions · {t.anonymity}</span>
              {t.warnings.length > 0 && <Chip state="draft">{t.warnings.length} warning(s)</Chip>}
              <span className="spacer" />
              {t.status === "draft" && <>
                <Button onClick={() => act(async () => { await api.peerTestAction(session, t.id, "launch"); return "Launched — placed on each cohort student's dashboard; cohort is now locked."; })}>Launch</Button>
                <Button variant="ghost" onClick={() => act(async () => { await api.peerTestAction(session, t.id, "cancel"); return "Cancelled cleanly — all placements removed."; })}>Cancel</Button>
              </>}
              {t.status === "launched" && <Button variant="ghost" onClick={() => act(async () => { await api.peerTestAction(session, t.id, "close"); return "Closed."; })}>Close</Button>}
            </li>
          ))}
        </ul>
      </Card>

      {selected && (
        <Card>
          <div className="card__head">
            <h2 className="section">{selected.title} <Chip state="locked">Computed — locked</Chip></h2>
            {selected.warnings.length > 0 && selected.warnings.map((w) => <Banner key={w} kind="warn">{w}</Banner>)}
          </div>

          {results && (
            <>
              <p className="muted">{results.completion.completed} of {results.completion.total} completed ({Math.round(results.completion.rate * 100)}%)</p>
              {selected.status === "launched" && (
                <div className="btn-row" style={{ marginTop: 0 }}>
                  <label className="person__meta" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    Record graded result
                    <select className="select" style={{ width: "auto" }} value={grade.studentId} onChange={(e) => setGrade({ ...grade, studentId: e.target.value })} aria-label="Student to grade">
                      <option value="">Student…</option>
                      {selected.cohort.map((sid) => {
                        const label = students.find((s) => s.id === sid)?.label ?? "Student";
                        return <option key={sid} value={sid}>{label}</option>;
                      })}
                    </select>
                  </label>
                  <input className="input" style={{ maxWidth: 110 }} type="number" min={0} max={100} placeholder="score %" value={grade.score} onChange={(e) => setGrade({ ...grade, score: e.target.value })} aria-label="Score out of 100" />
                  <Button disabled={!grade.studentId || grade.score === ""} onClick={() => act(async () => {
                    await api.recordPeerSubmission(session, selected.id, grade.studentId, Number(grade.score) / 100);
                    setGrade({ studentId: "", score: "" });
                    return "Graded result recorded.";
                  })}>Record</Button>
                </div>
              )}
              {results.requiresPublishDecision && (
                <Banner kind="warn">Results are <strong>withheld</strong> (the default). Students see nothing until you explicitly publish — there is no timer.</Banner>
              )}
              {results.benchmark.suppressed ? (
                <Banner kind="brand">{results.benchmark.suppressionReason}</Banner>
              ) : results.benchmark.students.length > 0 && (
                <div style={{ overflowX: "auto" }}>
                  <table className="heatmap" aria-label="Cohort benchmark (teacher-facing)">
                    <thead><tr><th scope="col">Student</th><th scope="col">Score</th><th scope="col">Percentile</th><th scope="col">Band</th></tr></thead>
                    <tbody>
                      {results.benchmark.students.map((s) => (
                        <tr key={s.studentId}>
                          <th scope="row">{s.label}</th>
                          <td>{Math.round(s.score * 100)}%</td>
                          <td>{s.percentile}</td>
                          <td>{bandText[s.band]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="btn-row">
                {results.publishState === "withheld"
                  ? <Button variant="primary" onClick={() => act(async () => { await api.peerTestAction(session, selected.id, "publish-benchmark"); return "Published — students see a softened, non-ranked signal only."; })}>Publish to students</Button>
                  : <Button onClick={() => act(async () => { await api.peerTestAction(session, selected.id, "withhold-benchmark"); return "Withheld again."; })}>Withhold</Button>}
              </div>

              {!results.benchmark.suppressed && results.benchmark.students.length > 0 && (
                <>
                  <h3 style={{ fontSize: 14, margin: "18px 0 8px" }}>Record a correction <span className="person__meta">(logged; the original submission is never overwritten)</span></h3>
                  <div className="row">
                    <Field label="Student" htmlFor="cor-student">
                      <select id="cor-student" className="select" value={correction.studentId} onChange={(e) => setCorrection({ ...correction, studentId: e.target.value })}>
                        <option value="">Choose…</option>
                        {results.benchmark.students.map((s) => <option key={s.studentId} value={s.studentId}>{s.label}</option>)}
                      </select>
                    </Field>
                    <Field label="Corrected score (0–100)" htmlFor="cor-score">
                      <input id="cor-score" className="input" type="number" min={0} max={100} value={correction.score} onChange={(e) => setCorrection({ ...correction, score: e.target.value })} />
                    </Field>
                  </div>
                  <Field label="Reason (required)" htmlFor="cor-reason">
                    <input id="cor-reason" className="input" value={correction.reason} onChange={(e) => setCorrection({ ...correction, reason: e.target.value })} placeholder="e.g. Grading error on question 2" />
                  </Field>
                  <Button disabled={!correction.studentId || correction.score === "" || !correction.reason.trim()} onClick={() => act(async () => {
                    await api.peerCorrection(session, selected.id, { studentId: correction.studentId, correctedScore: Number(correction.score) / 100, reason: correction.reason });
                    setCorrection({ studentId: "", score: "", reason: "" });
                    return "Correction recorded through the logged path.";
                  })}>Record correction</Button>
                </>
              )}
            </>
          )}

          {reviews && (
            <>
              <h3 style={{ fontSize: 14, margin: "22px 0 8px" }}>Peer reviews awaiting moderation</h3>
              {reviews.anonymityRisk && <Banner kind="warn">Small cohort — writing style may identify reviewers despite anonymisation. Consider that when moderating.</Banner>}
              {reviews.reviews.length === 0 ? (
                <p className="muted">Nothing pending. A round with no approved reviews shows students a neutral "no peer feedback" state.</p>
              ) : (
                <ul className="people">
                  {reviews.reviews.map((r) => (
                    <li className="person" key={r.id}>
                      <span style={{ flex: 1 }}>“{r.text}”</span>
                      <Button onClick={() => act(async () => { await api.moderateReview(session, r.id, "approve"); return "Review approved — the student will see it anonymised."; })}>Approve</Button>
                      <Button variant="ghost" onClick={() => act(async () => { await api.moderateReview(session, r.id, "reject"); return "Review rejected. You can hide a review, never rewrite it."; })}>Reject</Button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </Card>
      )}
    </PageShell>
  );
}
