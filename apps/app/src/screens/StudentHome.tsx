import { useCallback, useEffect, useRef, useState } from "react";
import { NotificationBell } from "../NotificationBell";
import { api, type HelpReply, type Session, type StudentTaskView, type StudentWorkspaceView } from "../api";
import { Banner, Button, Card, Chip, Field, TopBar } from "../components";

type Panel =
  | { kind: "workspace" }
  | { kind: "task"; taskId: string }
  | { kind: "attempt"; assessmentId: string; taskId: string }
  | { kind: "calendar" }
  | { kind: "peer"; peerTestId: string };

/**
 * STU-1..4 — the student workspace: a calm, low-analytics surface. Overdue is a
 * plain tag (never shaming); the Ask-for-Help tutor gives scoped hints and its
 * lockouts/escalations are decided in the domain; assessments autosave and
 * preserve work across connectivity loss; students only ever see published work.
 */
export function StudentHome({ session, displayName, onSignOut }: {
  session: Session; displayName: string; onSignOut: () => void;
}) {
  const [panel, setPanel] = useState<Panel>({ kind: "workspace" });
  const [ws, setWs] = useState<StudentWorkspaceView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => api.studentWorkspace(session).then(setWs).catch((e) => setError((e as Error).message)), [session]);
  useEffect(() => { void refresh(); }, [refresh]);

  const openTask = async (t: StudentTaskView) => {
    if (t.type === "assessment") {
      const detail = await api.studentTask(session, t.id);
      if (detail.assessmentId) { setPanel({ kind: "attempt", assessmentId: detail.assessmentId, taskId: t.id }); return; }
    }
    setPanel({ kind: "task", taskId: t.id });
  };

  return (
    <div className="app">
      <TopBar title={displayName} roleTag="Student" right={<NotificationBell session={session} />} />
      <main className="main">
        <div className="container">
          {error && <Banner kind="error">{error}</Banner>}
          {panel.kind === "workspace" && ws && (
            <Workspace session={session} ws={ws} onOpen={openTask} onCalendar={() => setPanel({ kind: "calendar" })}
              onOpenPeer={(id) => setPanel({ kind: "peer", peerTestId: id })} />
          )}
          {panel.kind === "task" && (
            <TaskDetail session={session} taskId={panel.taskId} onBack={() => { setPanel({ kind: "workspace" }); void refresh(); }} />
          )}
          {panel.kind === "attempt" && (
            <Attempt session={session} assessmentId={panel.assessmentId} taskId={panel.taskId}
              onBack={() => { setPanel({ kind: "workspace" }); void refresh(); }} />
          )}
          {panel.kind === "calendar" && (
            <CalendarPanel session={session} onBack={() => setPanel({ kind: "workspace" })} />
          )}
          {panel.kind === "peer" && (
            <PeerPanel session={session} peerTestId={panel.peerTestId} onBack={() => setPanel({ kind: "workspace" })} />
          )}
          <div className="btn-row"><span className="spacer" /><Button variant="ghost" onClick={onSignOut}>Sign out</Button></div>
        </div>
      </main>
    </div>
  );
}

function TaskRow({ t, onOpen }: { t: StudentTaskView; onOpen: (t: StudentTaskView) => void }) {
  return (
    <li className="person">
      <button className="linkish" onClick={() => onOpen(t)}><strong>{t.title}</strong></button>
      <span className="person__meta">{t.type} · due {t.dueDate.slice(0, 10)}</span>
      <span className="spacer" />
      {t.completed ? <Chip state="approved">Done</Chip>
        : t.overdue ? <Chip state="pending">Still to do</Chip>
        : null}
    </li>
  );
}

function Workspace({ session, ws, onOpen, onCalendar, onOpenPeer }: {
  session: Session; ws: StudentWorkspaceView; onOpen: (t: StudentTaskView) => void;
  onCalendar: () => void; onOpenPeer: (peerTestId: string) => void;
}) {
  const [peerTests, setPeerTests] = useState<Awaited<ReturnType<typeof api.studentPeerTests>>>([]);
  useEffect(() => { api.studentPeerTests(session).then(setPeerTests).catch(() => setPeerTests([])); }, [session]);

  return (
    <>
      <p className="eyebrow">Your work</p>
      <h1>Hi there</h1>
      <p className="lede">Here's what's on for today and this week. Take it one task at a time.</p>
      {!ws.hasTasks ? (
        <Card><Banner kind="brand">{ws.emptyMessage}</Banner></Card>
      ) : (
        <>
          <Card>
            <div className="card__head"><h2 className="section">Today</h2></div>
            {ws.today.length === 0 ? <p className="muted">Nothing due today.</p>
              : <ul className="people">{ws.today.map((t) => <TaskRow key={t.id} t={t} onOpen={onOpen} />)}</ul>}
          </Card>
          <Card>
            <div className="card__head"><h2 className="section">This week</h2></div>
            {ws.thisWeek.length === 0 ? <p className="muted">Nothing else this week.</p>
              : <ul className="people">{ws.thisWeek.map((t) => <TaskRow key={t.id} t={t} onOpen={onOpen} />)}</ul>}
          </Card>
        </>
      )}
      {peerTests.length > 0 && (
        <Card>
          <div className="card__head"><h2 className="section">Peer tests</h2></div>
          <ul className="people">
            {peerTests.map((p) => (
              <li className="person" key={p.peerTestId}>
                <button className="linkish" onClick={() => onOpenPeer(p.peerTestId)}><strong>{p.title}</strong></button>
                <span className="spacer" />
                <Chip state="pending">Delivered</Chip>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <div className="btn-row"><Button onClick={onCalendar}>My calendar</Button></div>
    </>
  );
}

function TaskDetail({ session, taskId, onBack }: { session: Session; taskId: string; onBack: () => void }) {
  const [task, setTask] = useState<Awaited<ReturnType<typeof api.studentTask>> | null>(null);
  const [chat, setChat] = useState<{ who: "you" | "tutor"; text: string }[]>([]);
  const [message, setMessage] = useState("");
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { api.studentTask(session, taskId).then(setTask).catch((e) => setError((e as Error).message)); }, [session, taskId]);

  const send = async () => {
    if (!message.trim()) return;
    setBusy(true); setError(null);
    const text = message.trim();
    setChat((c) => [...c, { who: "you", text }]);
    setMessage("");
    try {
      const reply: HelpReply = await api.askForHelp(session, taskId, text);
      if (!reply.available) setUnavailable(reply.message);
      else setChat((c) => [...c, { who: "tutor", text: reply.message }]);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const complete = async () => {
    setError(null);
    try { await api.completeStudentTask(session, taskId); onBack(); }
    catch (e) { setError((e as Error).message); }
  };

  const isAssessment = task?.type === "assessment";

  return (
    <>
      <button className="linkish" onClick={onBack}>← Back to your work</button>
      <h1 style={{ marginTop: 10 }}>{task?.title ?? "…"}</h1>
      {task && <p className="lede">{task.type} · due {task.dueDate.slice(0, 10)}</p>}
      {error && <Banner kind="error">{error}</Banner>}

      <Card>
        <div className="card__head">
          <h2 className="section">Ask for Help</h2>
          <p className="muted">Your tutor gives hints to get you unstuck — it won't do the work for you, and it only talks about this task.</p>
        </div>
        {isAssessment ? (
          <Banner kind="warn">Ask for Help is locked for assessments — it's just you and what you know. You've got this.</Banner>
        ) : unavailable ? (
          <Banner kind="warn">{unavailable}</Banner>
        ) : (
          <>
            {chat.length > 0 && (
              <ul className="people" style={{ marginBottom: 12 }}>
                {chat.map((m, i) => (
                  <li className="person" key={i} style={{ alignItems: "flex-start" }}>
                    <Chip state={m.who === "you" ? "pending" : "approved"}>{m.who === "you" ? "You" : "Tutor"}</Chip>
                    <span style={{ flex: 1 }}>{m.text}</span>
                  </li>
                ))}
              </ul>
            )}
            <Field label="What are you stuck on?" htmlFor="help-msg">
              <input id="help-msg" className="input" value={message} onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !busy && send()} />
            </Field>
            <Button variant="primary" onClick={send} disabled={busy || !message.trim()}>{busy ? "Thinking…" : "Ask"}</Button>
          </>
        )}
      </Card>

      {task && task.status !== "completed" && !isAssessment && (
        <Card>
          <div className="btn-row" style={{ marginTop: 0 }}>
            <Button onClick={complete}>Mark this task done</Button>
          </div>
        </Card>
      )}
    </>
  );
}

function Attempt({ session, assessmentId, taskId, onBack }: {
  session: Session; assessmentId: string; taskId: string; onBack: () => void;
}) {
  const [view, setView] = useState<Awaited<ReturnType<typeof api.studentAssessment>> | null>(null);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [offline, setOffline] = useState(!navigator.onLine);
  const [restored, setRestored] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wasOffline = useRef(false);
  const saveTimer = useRef<number | null>(null);

  // Start (or refuse: an unpublished assessment is denied at the permission
  // layer). The ref guards against a duplicate attempt from double-mounted
  // effects (React StrictMode in dev).
  const startedFor = useRef<string | null>(null);
  useEffect(() => {
    if (startedFor.current === assessmentId) return;
    startedFor.current = assessmentId;
    (async () => {
      try {
        const v = await api.studentAssessment(session, assessmentId);
        setView(v);
        const attempt = await api.startAttempt(session, assessmentId);
        setAttemptId(attempt.id);
        setAnswers(attempt.savedAnswers);
      } catch (e) { setError((e as Error).message); }
    })();
  }, [session, assessmentId]);

  // Offline/online: bank the state; on reconnect, mark interrupted + restore the save point.
  useEffect(() => {
    const goOffline = () => { wasOffline.current = true; setOffline(true); };
    const goOnline = async () => {
      setOffline(false);
      if (!wasOffline.current || !attemptId) return;
      try {
        await api.markAttemptInterrupted(session, attemptId);
        const r = await api.resumeAttempt(session, attemptId);
        if (r.resumable) { setAnswers((a) => ({ ...r.savedAnswers, ...a })); setRestored(true); }
      } catch { /* keep local answers; next save persists them */ }
    };
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => { window.removeEventListener("offline", goOffline); window.removeEventListener("online", goOnline); };
  }, [session, attemptId]);

  const setAnswer = (qid: string, value: string) => {
    setAnswers((a) => {
      const next = { ...a, [qid]: value };
      // Debounced autosave to the last save point (FR-ASM-004 work preservation).
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(async () => {
        if (!attemptId || !navigator.onLine) return;
        try { const r = await api.saveAttempt(session, attemptId, next); setSavedAt(r.lastSavedAt); } catch { /* retried on next change */ }
      }, 600);
      return next;
    });
  };

  const submit = async () => {
    if (!attemptId) return;
    setError(null);
    try { await api.submitAttempt(session, attemptId, answers); setSubmitted(true); await api.completeStudentTask(session, taskId).catch(() => undefined); }
    catch (e) { setError((e as Error).message); }
  };

  if (error) {
    return (
      <>
        <button className="linkish" onClick={onBack}>← Back to your work</button>
        <Card><Banner kind="warn">This assessment isn't available. If you think it should be, ask your teacher.</Banner></Card>
      </>
    );
  }

  return (
    <>
      <button className="linkish" onClick={onBack}>← Back to your work</button>
      <h1 style={{ marginTop: 10 }}>{view?.title ?? "…"}</h1>
      <p className="lede">Your answers save automatically. If your connection drops, your work is kept up to the last save point.</p>
      {offline && <Banner kind="warn">You're offline — keep working, your answers are safe here and will save when you're back online.</Banner>}
      {restored && <Banner kind="brand">Welcome back — your work was restored to the last save point.</Banner>}

      {submitted ? (
        <Card><Banner kind="brand">Submitted — nice work. Your teacher will take it from here.</Banner></Card>
      ) : view && (
        <Card>
          {view.questions.map((q) => (
            <Field key={q.id} label={`Q${q.order + 1}. ${q.prompt}`} htmlFor={`q-${q.id}`}>
              {q.options && q.options.length > 0 ? (
                <select id={`q-${q.id}`} className="select" value={answers[q.id] ?? ""} onChange={(e) => setAnswer(q.id, e.target.value)}>
                  <option value="">Choose…</option>
                  {q.options.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <textarea id={`q-${q.id}`} className="input" style={{ minHeight: 70 }} value={answers[q.id] ?? ""} onChange={(e) => setAnswer(q.id, e.target.value)} />
              )}
            </Field>
          ))}
          <div className="btn-row">
            <Button variant="primary" onClick={submit}>Submit</Button>
            {savedAt && <span className="muted">Saved {new Date(savedAt).toLocaleTimeString()}</span>}
          </div>
        </Card>
      )}
    </>
  );
}

/**
 * Peer-test panel. The student sees the delivered test and — only once the
 * teacher explicitly publishes — the softened, non-ranked signal. Student-
 * authored peer reviews were removed from this surface at the owner's
 * direction (2026-08-13); the FR-PEER-002 review/moderation backend remains
 * intact and tested, so the panel can regain the form if that decision flips.
 */
function PeerPanel({ session, peerTestId, onBack }: { session: Session; peerTestId: string; onBack: () => void }) {
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof api.studentPeerTest>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.studentPeerTest(session, peerTestId).then(setDetail).catch((e) => setError((e as Error).message));
  }, [session, peerTestId]);

  return (
    <>
      <button className="linkish" onClick={onBack}>← Back to your work</button>
      <h1 style={{ marginTop: 10 }}>{detail?.title ?? "…"}</h1>
      {detail && <p className="lede">{detail.questionCount} question{detail.questionCount === 1 ? "" : "s"}{detail.rubric ? ` · ${detail.rubric}` : ""}</p>}
      {error && <Banner kind="error">{error}</Banner>}

      {detail && (
        <Card>
          <div className="card__head"><h2 className="section">How you went</h2></div>
          {/* Softened, non-ranked, and only what the teacher explicitly published. */}
          <Banner kind="brand">{detail.signal.message}</Banner>
        </Card>
      )}
    </>
  );
}

function CalendarPanel({ session, onBack }: { session: Session; onBack: () => void }) {
  const [items, setItems] = useState<Awaited<ReturnType<typeof api.studentCalendar>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.studentCalendar(session).then(setItems).catch((e) => setError((e as Error).message)); }, [session]);

  return (
    <>
      <button className="linkish" onClick={onBack}>← Back to your work</button>
      <h1 style={{ marginTop: 10 }}>My calendar</h1>
      <p className="lede">Your tasks and school events. Anything that moved is marked.</p>
      {error && <Banner kind="error">{error}</Banner>}
      <Card>
        {items && items.length === 0 && <Banner kind="brand">Nothing on the calendar yet.</Banner>}
        <ul className="people">
          {(items ?? []).map((e) => (
            <li className="person" key={`${e.id}-${e.date}`}>
              <span><strong>{e.title}</strong></span>
              <span className="person__meta">{e.date.slice(0, 10)} · {e.type}</span>
              <span className="spacer" />
              {e.changed && <Chip state="pending">Date changed</Chip>}
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
