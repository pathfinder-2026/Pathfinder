import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type AssessmentDetail, type AssessmentRow, type AttemptRow, type Session, type SkillsResult } from "../api";
import { Banner, Button, Card, Chip, Field, PageShell } from "../components";
import { SkillPicker } from "../SkillPicker";

/**
 * TCH-4/5 — Assessment Builder + review/publish. Generation is grounded ONLY in
 * the approved+mapped pool (a shortfall is stated honestly, a mid-run failure
 * saves no partial draft), and publishing is gated behind an explicit
 * review-acknowledgement. Publish is reversible before the scheduled start.
 */
export function TeacherAssessments({ session, displayName, onBack, onSignOut, onOpenContent }: {
  session: Session; displayName: string; onBack: () => void; onSignOut: () => void;
  /** Navigate to Content Studio — the fix path when generation declines. */
  onOpenContent?: () => void;
}) {
  const [rows, setRows] = useState<AssessmentRow[] | null>(null);
  const [skills, setSkills] = useState<SkillsResult | null>(null);
  const [capacity, setCapacity] = useState<Record<string, number>>({});
  const [detail, setDetail] = useState<AssessmentDetail | null>(null);
  const [attempts, setAttempts] = useState<AttemptRow[] | null>(null);
  const [openAttemptId, setOpenAttemptId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [declined, setDeclined] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Generate form
  const [title, setTitle] = useState("");
  const [nodeId, setNodeId] = useState("");
  const [count, setCount] = useState(3);
  const [difficulty, setDifficulty] = useState("mixed");

  const refresh = useCallback(async () => {
    try {
      const [list, sk, cap] = await Promise.all([
        api.listAssessments(session), api.skills(session), api.assessmentCapacity(session),
      ]);
      setRows(list); setSkills(sk); setCapacity(cap);
      return list;
    } catch (e) { setError((e as Error).message); return []; }
  }, [session]);

  useEffect(() => { void refresh(); }, [refresh]);

  const openDetail = async (id: string) => {
    setError(null); setAttempts(null); setOpenAttemptId(null);
    try {
      const [d, at] = await Promise.all([api.getAssessment(session, id), api.listAttempts(session, id)]);
      setDetail(d); setAttempts(at);
    } catch (e) { setError((e as Error).message); }
  };

  const generate = async () => {
    setError(null); setNotice(null); setDeclined(null); setBusy(true);
    try {
      const result = await api.generateAssessment(session, { title, nodeId, count, difficulty });
      if (result.status === "failed") {
        // Honest failed state: no partial draft was saved.
        setError(result.reason);
      } else if (result.status === "declined") {
        // Nothing was created — the message says exactly what to fix.
        setDeclined(result.message);
      } else {
        setNotice(result.shortfall
          ? `Draft created with ${result.questionCount} of ${result.shortfall.requested} requested questions — the approved pool couldn't ground more.`
          : `Draft created with ${result.questionCount} questions. Review it before publishing.`);
        setTitle("");
        await refresh();
        await openDetail(result.assessmentId);
      }
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const act = async (fn: () => Promise<unknown>, doneMsg: string) => {
    setError(null); setNotice(null); setBusy(true);
    try {
      await fn();
      setNotice(doneMsg);
      if (detail) await openDetail(detail.id);
      await refresh();
    } catch (e) {
      if (e instanceof ApiError && e.code === "REVIEW_REQUIRED") setError("Review the generated questions and acknowledge the review before publishing.");
      else if (e instanceof ApiError && e.code === "ALREADY_STARTED") setError("The scheduled start has passed — publishing can no longer be reversed.");
      else if (e instanceof ApiError && e.code === "EMPTY_ASSESSMENT") setError("This assessment has no questions, so it can't be published to students.");
      else setError((e as Error).message);
    } finally { setBusy(false); }
  };

  const selectedCapacity = nodeId ? capacity[nodeId] ?? 0 : null;
  const nodeLabel = (id: string) => (skills?.signedOff ? skills.nodes.find((n) => n.id === id)?.label : null) ?? id;

  return (
    <PageShell displayName={displayName} title="Assessments" roleTag="Teacher" backLabel="Back to teacher home"
      onBack={onBack} onSignOut={onSignOut}
      lede="Drafts are generated only from your approved, skill-mapped material — never invented. Every draft stays invisible to students until you review it and explicitly publish.">
      {error && <Banner kind="error">{error}</Banner>}
      {notice && <Banner kind="brand">{notice}</Banner>}
      {declined && (
        <Banner kind="warn">
          {declined}
          {onOpenContent && <> <Button variant="ghost" onClick={onOpenContent}>Open Content Studio</Button></>}
        </Banner>
      )}

      <Card>
        <div className="card__head"><h2 className="section">Generate a draft</h2></div>
        {skills && !skills.signedOff ? (
          <Banner kind="warn">Assessment generation needs a signed-off skill graph and approved, mapped content. Ask your administrator to sign off the curriculum graph.</Banner>
        ) : (
          <>
            <Field label="Title"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
            <div className="row">
              <SkillPicker
                skills={skills} value={nodeId} onChange={setNodeId} capacity={capacity} countNoun="questions"
                idPrefix="asm"
                hint="Only skills with approved, mapped material can ground questions — approve and map more in Content Studio to unlock the rest."
              />
            </div>
            <div className="row">
              <Field label="Questions" hint={selectedCapacity !== null
                ? `Your approved material can ground up to ${selectedCapacity} question${selectedCapacity === 1 ? "" : "s"} for this skill.`
                : "Limited by how many sections your approved material can ground."}>
                <input className="input" type="number" min={1} max={20} value={count} onChange={(e) => setCount(Number(e.target.value))} />
              </Field>
              <Field label="Difficulty">
                <select className="select" value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
                  <option value="easy">easy</option><option value="mixed">mixed</option><option value="hard">hard</option>
                </select>
              </Field>
            </div>
            <Button variant="primary" onClick={generate} disabled={busy || !title.trim() || !nodeId || selectedCapacity === 0}>
              {busy ? "Generating…" : "Generate draft"}
            </Button>
          </>
        )}
      </Card>

      <Card>
        <div className="card__head"><h2 className="section">Your assessments {rows ? `— ${rows.length}` : ""}</h2></div>
        {!rows ? <div className="muted">Loading…</div>
          : rows.length === 0 ? <div className="muted">No assessments yet — generate a draft above.</div>
          : (
            <ul className="people">
              {rows.map((r) => (
                <li className="person" key={r.id}>
                  <span><strong>{r.title}</strong></span>
                  <span className="person__meta">{nodeLabel(r.nodeId)} · {r.questionCount} questions</span>
                  {r.targetStudentId && <Chip state="pending">Tailored — one student</Chip>}
                  {r.shortfall && <Chip state="pending">Shortfall</Chip>}
                  <span className="spacer" />
                  <Chip state={r.status === "published" ? "approved" : "draft"}>{r.status === "published" ? "Published" : "Draft"}</Chip>
                  <Button variant="ghost" onClick={() => openDetail(r.id)}>Review</Button>
                </li>
              ))}
            </ul>
          )}
      </Card>

      {detail && (
        <Card>
          <div className="card__head">
            <h2 className="section">{detail.title} <Chip state={detail.status === "published" ? "approved" : "draft"}>{detail.status === "published" ? "Published" : "Draft"}</Chip></h2>
            <p className="muted">{nodeLabel(detail.nodeId)}</p>
          </div>
          {detail.tailoringRationale && (
            <Banner kind="brand">
              <strong>Tailored for one student — why this shape:</strong> {detail.tailoringRationale}
            </Banner>
          )}
          {detail.shortfall && (
            <Banner kind="warn">
              Only {detail.shortfall.generated} of {detail.shortfall.requested} requested questions could be grounded in your approved material — {detail.shortfall.reason}. Approve and map more material to support more.
            </Banner>
          )}
          {detail.flags.includes("difficulty_balance_unmet") && (
            <Banner kind="warn">The requested difficulty balance couldn't be fully met from the available material.</Banner>
          )}
          <ol style={{ margin: "0 0 6px", paddingLeft: 22, display: "flex", flexDirection: "column", gap: 14 }}>
            {detail.questions.map((q) => (
              <li key={q.id} style={{ fontSize: 14 }}>
                <div><strong>{q.prompt}</strong> <span className="person__meta">({q.type.replace(/_/g, " ")} · {q.difficulty})</span></div>
                {q.options && <div className="muted" style={{ marginTop: 4 }}>Options: {q.options.join(" · ")}</div>}
                {q.modelAnswer && <div className="muted" style={{ marginTop: 4 }}>Model answer: {q.modelAnswer}</div>}
                {q.rubric && <div className="muted" style={{ marginTop: 4 }}>Rubric: {q.rubric}</div>}
                <div className="person__meta" style={{ marginTop: 4 }}>Grounded in: {q.groundingSources.join(", ")}</div>
              </li>
            ))}
          </ol>
          {detail.status === "published" && (
            <AssignPanel session={session} assessmentId={detail.id} title={detail.title} nodeId={detail.nodeId}
              onAssigned={(msg) => { setNotice(msg); void openDetail(detail.id); }} onError={setError} />
          )}

          {attempts && detail.status === "published" && attempts.length === 0 && (
            <p className="muted" style={{ marginTop: 14 }}>No attempts yet — students haven't started this assessment.</p>
          )}
          {attempts && attempts.length > 0 && (
            <>
              <h3 style={{ fontSize: 14, margin: "18px 0 4px" }}>
                Attempts & grades <span className="person__meta">({attempts.filter((a) => a.status === "submitted").length} of {attempts.length} submitted · grades are teacher-only, never shown to students)</span>
              </h3>
              <ul className="people">
                {attempts.map((a) => {
                  const pct = a.gradedScore != null ? `${Math.round(a.gradedScore * 100)}%` : null;
                  return (
                    <li key={a.id} style={{ display: "block", padding: "8px 0", borderBottom: "1px solid var(--pf-border)" }}>
                      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                        <strong>{a.studentLabel}</strong>
                        <Chip state={a.status === "submitted" ? "approved" : "pending"}>{a.status === "submitted" ? "Submitted" : "In progress"}</Chip>
                        {a.interrupted && <Chip state="draft">Connection lost mid-attempt</Chip>}
                        <span className="spacer" />
                        {pct
                          ? <span><strong>{pct}</strong> <span className="person__meta">graded {a.gradedAt ? new Date(a.gradedAt).toLocaleString() : ""}</span></span>
                          : a.status === "submitted"
                            ? <Chip state="pending">Not graded — AI grading unavailable at submit</Chip>
                            : <span className="person__meta">answers saved {new Date(a.lastSavedAt).toLocaleString()}</span>}
                        <Button variant="ghost" onClick={() => setOpenAttemptId(openAttemptId === a.id ? null : a.id)}>
                          {openAttemptId === a.id ? "Hide answers" : "View answers"}
                        </Button>
                      </div>
                      {openAttemptId === a.id && (
                        <ol style={{ margin: "10px 0 4px", paddingLeft: 22, display: "flex", flexDirection: "column", gap: 10 }}>
                          {detail.questions.map((q) => {
                            const result = a.gradedResults?.find((r) => r.questionId === q.id);
                            const answer = a.savedAnswers[q.id];
                            return (
                              <li key={q.id} style={{ fontSize: 13 }}>
                                <div><strong>{q.prompt}</strong></div>
                                <div style={{ marginTop: 2 }}>
                                  {answer != null && answer !== ""
                                    ? <>Student answered: “{answer}”</>
                                    : <span className="muted">Not answered</span>}
                                </div>
                                {q.modelAnswer && <div className="muted" style={{ marginTop: 2 }}>Model answer: {q.modelAnswer}</div>}
                                {result && (
                                  <div style={{ marginTop: 2 }}>
                                    <Chip state={result.correct ? "approved" : "draft"}>
                                      {result.correct ? "Correct" : "Needs work"} · {Math.round(result.score * 100)}%
                                    </Chip>
                                  </div>
                                )}
                              </li>
                            );
                          })}
                        </ol>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          <div className="btn-row">
            {detail.status === "draft" && !detail.reviewAcknowledged && (
              <Button variant="primary" onClick={() => act(() => api.acknowledgeReview(session, detail.id), "Review acknowledged — you can publish now.")} disabled={busy}>
                I've reviewed these questions
              </Button>
            )}
            {detail.status === "draft" && detail.reviewAcknowledged && (
              <Button variant="primary" onClick={() => act(() => api.publishAssessment(session, detail.id), "Published — students can now be assigned this assessment.")} disabled={busy}>
                Publish
              </Button>
            )}
            {detail.status === "draft" && !detail.reviewAcknowledged && (
              <span className="muted">Publishing unlocks after you acknowledge the review.</span>
            )}
            {detail.status === "published" && (
              <>
                <Button onClick={() => act(() => api.unpublishAssessment(session, detail.id), "Unpublished — back to draft.")} disabled={busy}>Unpublish</Button>
                <span className="muted">Reversible until the scheduled start.</span>
              </>
            )}
            <span className="spacer" />
            <Button variant="ghost" onClick={() => setDetail(null)}>Close</Button>
          </div>
        </Card>
      )}
    </PageShell>
  );
}

type AssignMode = "class" | "pick" | "skill";

/**
 * Assign a published assessment to students (task #9). Three targeting modes —
 * whole class, hand-picked, or everyone below mastery on this skill — and every
 * mode is suggest-then-confirm: the checkboxes are the final word, and nothing
 * is assigned until the teacher explicitly clicks Assign.
 */
function AssignPanel({ session, assessmentId, title, nodeId, onAssigned, onError }: {
  session: Session; assessmentId: string; title: string; nodeId: string;
  onAssigned: (msg: string) => void; onError: (msg: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([]);
  const [classId, setClassId] = useState("");
  const [standing, setStanding] = useState<{ studentId: string; label: string; score: number | null; belowMastery: boolean; noData: boolean }[]>([]);
  const [mode, setMode] = useState<AssignMode>("class");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dueDate, setDueDate] = useState(() => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  const [baseline, setBaseline] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    api.teacherClasses(session).then((cs) => {
      setClasses(cs);
      if (cs.length > 0) setClassId((c) => c || cs[0]!.id);
    }).catch((e) => onError((e as Error).message));
  }, [open, session, onError]);

  // One load serves every mode: the same roster carries each student's standing
  // on this assessment's skill, so switching modes just changes the preselection.
  useEffect(() => {
    if (!open || !classId) return;
    api.skillStanding(session, classId, nodeId).then((rows) => {
      setStanding(rows);
      setSelected(new Set(rows.map((r) => r.studentId))); // default: whole class
      setMode("class");
    }).catch((e) => onError((e as Error).message));
  }, [open, classId, session, nodeId, onError]);

  const applyMode = (m: AssignMode) => {
    setMode(m);
    if (m === "class") setSelected(new Set(standing.map((r) => r.studentId)));
    if (m === "skill") setSelected(new Set(standing.filter((r) => r.belowMastery).map((r) => r.studentId)));
    if (m === "pick") setSelected(new Set());
  };

  const toggle = (id: string) => setSelected((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const assign = async () => {
    setBusy(true);
    try {
      const r = await api.assignWork(session, {
        studentIds: [...selected], classId, type: "assessment", title,
        nodeId, assessmentId, dueDate, baseline,
      });
      onAssigned(baseline
        ? `Baseline check assigned to ${r.assigned} student${r.assigned === 1 ? "" : "s"} — their results will set each student's starting line for this concept.`
        : `Assigned to ${r.assigned} student${r.assigned === 1 ? "" : "s"} — it now appears in their workspace with the due date.`);
      setOpen(false);
    } catch (e) { onError((e as Error).message); } finally { setBusy(false); }
  };

  if (!open) {
    return (
      <div style={{ margin: "14px 0" }}>
        <Button variant="primary" onClick={() => setOpen(true)}>Assign to students…</Button>
      </div>
    );
  }

  const belowCount = standing.filter((r) => r.belowMastery).length;
  return (
    <div style={{ border: "1px solid var(--pf-border)", borderRadius: 10, padding: 14, margin: "14px 0" }}>
      <h3 style={{ fontSize: 14, margin: "0 0 8px" }}>Assign “{title}”</h3>
      <div className="row">
        <Field label="Class" htmlFor="as-class">
          <select id="as-class" className="select" value={classId} onChange={(e) => setClassId(e.target.value)}>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Who" htmlFor="as-mode">
          <select id="as-mode" className="select" value={mode} onChange={(e) => applyMode(e.target.value as AssignMode)}>
            <option value="class">Whole class</option>
            <option value="pick">Pick students</option>
            <option value="skill">Below mastery on this skill{belowCount ? ` (${belowCount})` : ""}</option>
          </select>
        </Field>
        <Field label="Due date" htmlFor="as-due">
          <input id="as-due" className="input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
      </div>
      {mode === "skill" && belowCount === 0 && (
        <Banner kind="brand">No one is below mastery on this skill yet{standing.some((r) => r.noData) ? " — most students have no data. A baseline check (below) is how you get a starting line." : "."}</Banner>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "8px 0" }}>
        {standing.map((r) => (
          <label key={r.studentId} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, border: "1px solid var(--pf-border)", borderRadius: 999, padding: "4px 10px" }}>
            <input type="checkbox" checked={selected.has(r.studentId)} onChange={() => toggle(r.studentId)} aria-label={`Include ${r.label}`} />
            {r.label}
            {r.noData
              ? <span className="person__meta">no data</span>
              : <span className="person__meta">{Math.round((r.score ?? 0) * 100)}%</span>}
          </label>
        ))}
        {standing.length === 0 && <span className="muted">No students in this class yet.</span>}
      </div>
      <label className="field" style={{ display: "flex", gap: 8, alignItems: "center", margin: "6px 0 10px" }}>
        <input type="checkbox" checked={baseline} onChange={(e) => setBaseline(e.target.checked)} />
        <span className="field__label" style={{ margin: 0 }}>
          Baseline check (starting a new concept) — <span className="person__meta">results set each student's starting line; students see it as planning help, not a graded test</span>
        </span>
      </label>
      <div className="btn-row" style={{ marginTop: 0 }}>
        <Button variant="primary" onClick={assign} disabled={busy || selected.size === 0}>
          {busy ? "Assigning…" : `Assign to ${selected.size} student${selected.size === 1 ? "" : "s"}`}
        </Button>
        {selected.size === 0 && <span className="muted">Tick at least one student.</span>}
        <span className="spacer" />
        <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  );
}
