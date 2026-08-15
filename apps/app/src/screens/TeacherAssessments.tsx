import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type AssessmentDetail, type AssessmentRow, type Session, type SkillsResult } from "../api";
import { Banner, Button, Card, Chip, Field, PageShell } from "../components";

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
    setError(null);
    try { setDetail(await api.getAssessment(session, id)); } catch (e) { setError((e as Error).message); }
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

  const nodeOptions = skills?.signedOff ? skills.nodes.filter((n) => n.type === "subskill" || n.type === "skill") : [];
  const readyNodes = nodeOptions.filter((n) => (capacity[n.id] ?? 0) > 0);
  const emptyNodes = nodeOptions.filter((n) => (capacity[n.id] ?? 0) === 0);
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
            <div className="row">
              <Field label="Title"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
              <Field label="Skill" hint="Only skills with approved, mapped material can ground questions — approve and map more in Content Studio to unlock the rest.">
                <select className="select" value={nodeId} onChange={(e) => setNodeId(e.target.value)}>
                  <option value="">Choose a skill…</option>
                  <optgroup label="Ready to generate">
                    {readyNodes.map((n) => (
                      <option key={n.id} value={n.id}>{n.label}{n.code ? ` (${n.code})` : ""} — up to {capacity[n.id]} questions</option>
                    ))}
                  </optgroup>
                  <optgroup label="No approved material yet">
                    {emptyNodes.map((n) => (
                      <option key={n.id} value={n.id} disabled>{n.label}{n.code ? ` (${n.code})` : ""}</option>
                    ))}
                  </optgroup>
                </select>
              </Field>
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
