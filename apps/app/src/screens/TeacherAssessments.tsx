import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type AssessmentDetail, type AssessmentRow, type AttemptRow, type Session, type SkillsResult } from "../api";
import { Banner, Button, Card, Chip, Field, PageShell } from "../components";
import { NotificationBell } from "../NotificationBell";
import { SkillMultiPicker, SkillPicker } from "../SkillPicker";

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
  const [editingQ, setEditingQ] = useState<{ id: string; prompt: string; modelAnswer: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [declined, setDeclined] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Generate form. Concepts are multi-select (#19): a term's assessment normally
  // covers several, and forcing one meant generating three separate drafts.
  const [title, setTitle] = useState("");
  const [nodeIds, setNodeIds] = useState<string[]>([]);
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
      const result = await api.generateAssessment(session, { title, nodeIds, count, difficulty });
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

  const nodeLabel = (id: string) => (skills?.signedOff ? skills.nodes.find((n) => n.id === id)?.label : null) ?? id;
  const nodeLabels = (ids: string[]) => (ids.length ? ids : []).map(nodeLabel).join(" · ");

  /**
   * The guaranteed floor for the selection. Summing would double-count concepts
   * that share a source — the common case now that material is filed at subject
   * level — so this is the largest single concept's capacity and is worded as a
   * floor, not a ceiling. Zero still means zero: every chosen concept is
   * ungrounded, so generation would certainly decline.
   */
  const selectedCapacity = nodeIds.length === 0
    ? null
    : Math.max(...nodeIds.map((id) => capacity[id] ?? 0));

  return (
    <PageShell topRight={<NotificationBell session={session} />} displayName={displayName} title="Assessments" roleTag="Teacher" backLabel="Back to teacher home"
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
              <SkillMultiPicker
                skills={skills} values={nodeIds} onChange={setNodeIds} capacity={capacity} countNoun="questions"
                idPrefix="asm"
                hint="Tick every concept this assessment should cover. Only concepts with approved material behind them can ground questions — file more in Content Studio to unlock the rest."
              />
            </div>
            <div className="row">
              <Field label="Questions" hint={selectedCapacity !== null
                ? `Your approved material can ground at least ${selectedCapacity} question${selectedCapacity === 1 ? "" : "s"} here — more where the concepts draw on different material.`
                : "Limited by how many sections your approved material can ground."}>
                <input className="input" type="number" min={1} max={20} value={count} onChange={(e) => setCount(Number(e.target.value))} />
              </Field>
              <Field label="Difficulty">
                <select className="select" value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
                  <option value="easy">easy</option><option value="mixed">mixed</option><option value="hard">hard</option>
                </select>
              </Field>
            </div>
            <Button variant="primary" onClick={generate} disabled={busy || !title.trim() || nodeIds.length === 0 || selectedCapacity === 0}>
              {busy ? "Generating…" : "Generate draft"}
            </Button>
          </>
        )}
      </Card>

      <ManualAuthorCard skills={skills} session={session} busy={busy}
        onCreated={async (id, n) => { setNotice(`Assessment created with ${n} question${n === 1 ? "" : "s"} — your own words, ready to publish after review.`); await refresh(); await openDetail(id); }}
        onError={setError} />

      <Card>
        <div className="card__head"><h2 className="section">Your assessments {rows ? `— ${rows.length}` : ""}</h2></div>
        {!rows ? <div className="muted">Loading…</div>
          : rows.length === 0 ? <div className="muted">No assessments yet — generate a draft above.</div>
          : (
            <ul className="people">
              {rows.map((r) => (
                <li className="person" key={r.id}>
                  <span><strong>{r.title}</strong></span>
                  <span className="person__meta">{nodeLabels(r.nodeIds)} · {r.questionCount} questions</span>
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
            <p className="muted">{nodeLabels(detail.nodeIds)}</p>
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
          {/* #19 — nothing is mapped to these concepts specifically, so the
              questions come from whatever is filed above them. Worth saying
              plainly: it's what the teacher is about to put their name to. */}
          {detail.flags.includes("grounded_at_broader_level") && (
            <Banner kind="warn">
              No material is mapped to these concepts specifically, so the questions were drawn from material filed
              higher up the curriculum. Map material straight to a concept in Content Studio (under More options) to
              narrow what it draws on.
            </Banner>
          )}
          <ol style={{ margin: "0 0 6px", paddingLeft: 22, display: "flex", flexDirection: "column", gap: 14 }}>
            {detail.questions.map((q) => (
              <li key={q.id} style={{ fontSize: 14 }}>
                {editingQ?.id === q.id ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <Field label="Question" htmlFor={`eq-p-${q.id}`}>
                      <textarea id={`eq-p-${q.id}`} className="input" rows={2} value={editingQ.prompt} onChange={(e) => setEditingQ({ ...editingQ, prompt: e.target.value })} />
                    </Field>
                    <Field label="Model answer" htmlFor={`eq-m-${q.id}`}>
                      <input id={`eq-m-${q.id}`} className="input" value={editingQ.modelAnswer} onChange={(e) => setEditingQ({ ...editingQ, modelAnswer: e.target.value })} />
                    </Field>
                    <div className="btn-row" style={{ marginTop: 0 }}>
                      <Button variant="primary" disabled={busy || !editingQ.prompt.trim()} onClick={() => act(async () => {
                        await api.editQuestion(session, detail.id, q.id, { prompt: editingQ.prompt, modelAnswer: editingQ.modelAnswer || null });
                        setEditingQ(null);
                      }, "Question updated — recorded as edited by you.")}>Save</Button>
                      <Button variant="ghost" onClick={() => setEditingQ(null)}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div>
                      <strong>{q.prompt}</strong> <span className="person__meta">({q.type.replace(/_/g, " ")} · {q.difficulty})</span>
                      {q.teacherAuthored && <> <Chip state="approved">Written by you</Chip></>}
                      {q.teacherEdited && !q.teacherAuthored && <> <Chip state="pending">Edited by you</Chip></>}
                    </div>
                    {q.options && <div className="muted" style={{ marginTop: 4 }}>Options: {q.options.join(" · ")}</div>}
                    {q.modelAnswer && <div className="muted" style={{ marginTop: 4 }}>Model answer: {q.modelAnswer}</div>}
                    {q.rubric && <div className="muted" style={{ marginTop: 4 }}>Rubric: {q.rubric}</div>}
                    <div className="person__meta" style={{ marginTop: 4 }}>
                      {q.teacherAuthored ? "Your own material" : `Grounded in: ${q.groundingSources.join(", ")}`}
                      {detail.status === "draft" && (
                        <>
                          {" · "}
                          <button className="linkish" onClick={() => setEditingQ({ id: q.id, prompt: q.prompt, modelAnswer: q.modelAnswer ?? "" })}>Edit</button>
                          {" · "}
                          <button className="linkish" onClick={() => act(() => api.deleteQuestion(session, detail.id, q.id), "Question removed.")}>Remove</button>
                        </>
                      )}
                    </div>
                  </>
                )}
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

/**
 * Write-your-own assessment (task #6): the teacher's own questions, no AI and no
 * grounding requirement — their words ARE the provenance. Joins the same
 * review-acknowledge + publish flow as generated drafts.
 */
function ManualAuthorCard({ skills, session, busy, onCreated, onError }: {
  skills: SkillsResult | null; session: Session; busy: boolean;
  onCreated: (assessmentId: string, questionCount: number) => Promise<void>; onError: (msg: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [nodeId, setNodeId] = useState("");
  const [qs, setQs] = useState<{ prompt: string; modelAnswer: string }[]>([{ prompt: "", modelAnswer: "" }]);
  const [creating, setCreating] = useState(false);

  const create = async () => {
    setCreating(true);
    try {
      const filled = qs.filter((q) => q.prompt.trim());
      const r = await api.createManualAssessment(session, {
        title, nodeId, questions: filled.map((q) => ({ prompt: q.prompt, modelAnswer: q.modelAnswer || null })),
      });
      setOpen(false); setTitle(""); setQs([{ prompt: "", modelAnswer: "" }]); setNodeId("");
      await onCreated(r.assessmentId, r.questionCount);
    } catch (e) { onError((e as Error).message); } finally { setCreating(false); }
  };

  return (
    <Card>
      <div className="card__head">
        <h2 className="section">Write your own</h2>
        <p className="muted">Already have the questions — last year's paper, your own drills? Type them in. No AI involved; your words are the source, and the same review-and-publish gate applies.</p>
      </div>
      {!open ? (
        <Button onClick={() => setOpen(true)}>Write an assessment</Button>
      ) : (
        <>
          <Field label="Title"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          <div className="row">
            <SkillPicker skills={skills} value={nodeId} onChange={setNodeId} idPrefix="man"
              hint="Which skill this assesses — results feed that skill's mastery picture." />
          </div>
          {qs.map((q, i) => (
            <div key={i} style={{ border: "1px solid var(--pf-border)", borderRadius: 10, padding: 12, marginBottom: 10 }}>
              <Field label={`Question ${i + 1}`} htmlFor={`mq-${i}`}>
                <textarea id={`mq-${i}`} className="input" rows={2} value={q.prompt}
                  onChange={(e) => setQs(qs.map((x, j) => j === i ? { ...x, prompt: e.target.value } : x))} />
              </Field>
              <Field label="Model answer (optional — used for AI grading)" htmlFor={`ma-${i}`}>
                <input id={`ma-${i}`} className="input" value={q.modelAnswer}
                  onChange={(e) => setQs(qs.map((x, j) => j === i ? { ...x, modelAnswer: e.target.value } : x))} />
              </Field>
              {qs.length > 1 && (
                <button className="linkish" onClick={() => setQs(qs.filter((_, j) => j !== i))}>Remove this question</button>
              )}
            </div>
          ))}
          <div className="btn-row">
            <Button onClick={() => setQs([...qs, { prompt: "", modelAnswer: "" }])}>Add another question</Button>
            <Button variant="primary" onClick={create}
              disabled={busy || creating || !title.trim() || !nodeId || !qs.some((q) => q.prompt.trim())}>
              {creating ? "Creating…" : "Create draft"}
            </Button>
            <span className="spacer" />
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </>
      )}
    </Card>
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
  const [approved, setApproved] = useState<{ id: string; title: string }[]>([]);
  const [contentId, setContentId] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    Promise.all([api.teacherClasses(session), api.listContent(session)]).then(([cs, content]) => {
      setClasses(cs);
      if (cs.length > 0) setClassId((c) => c || cs[0]!.id);
      // Only approved items can be attached ("where is the worksheet?" fix) —
      // material mapped to this assessment's skill floats to the top.
      const pool = content.filter((c) => c.status === "approved" && !c.archived);
      setApproved([
        ...pool.filter((c) => c.mappedNodeIds.includes(nodeId)),
        ...pool.filter((c) => !c.mappedNodeIds.includes(nodeId)),
      ].map((c) => ({ id: c.id, title: c.title })));
    }).catch((e) => onError((e as Error).message));
  }, [open, session, nodeId, onError]);

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
        nodeId, assessmentId, contentId: contentId || null, dueDate, baseline,
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
        <Field label="Attach material" htmlFor="as-material" hint="Approved material renders inside the task, so students aren't left asking where the worksheet is.">
          <select id="as-material" className="select" value={contentId} onChange={(e) => setContentId(e.target.value)}>
            <option value="">None</option>
            {approved.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
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
