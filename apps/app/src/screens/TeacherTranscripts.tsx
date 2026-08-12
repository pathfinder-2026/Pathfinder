import { useEffect, useState } from "react";
import { api, type Session } from "../api";
import { Banner, Card, Chip, PageShell } from "../components";

/**
 * TCH-14 — Ask-for-Help transcripts, visible to the ASSIGNING teacher only
 * (FR-SAG / FR-PDB-005 boundary). This surface lists only the caller's own
 * sessions; the transcript read is re-checked in the domain, and no Principal
 * route or export can ever reach it.
 */
export function TeacherTranscripts({ session, displayName, onBack, onSignOut }: {
  session: Session; displayName: string; onBack: () => void; onSignOut: () => void;
}) {
  const [sessions, setSessions] = useState<Awaited<ReturnType<typeof api.helpSessions>> | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<Awaited<ReturnType<typeof api.helpTranscript>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { api.helpSessions(session).then(setSessions).catch((e) => setError((e as Error).message)); }, [session]);

  const open = async (sessionId: string) => {
    setOpenId(sessionId); setTranscript(null); setError(null);
    try { setTranscript(await api.helpTranscript(session, sessionId)); }
    catch (e) { setError((e as Error).message); }
  };

  return (
    <PageShell displayName={displayName} title="Ask-for-Help transcripts" roleTag="Teacher" backLabel="Back to teacher home"
      onBack={onBack} onSignOut={onSignOut}
      lede="Transcripts for tasks you assigned. Only the assigning teacher can read a transcript — they are unreachable from any Principal surface or export.">
      {error && <Banner kind="error">{error}</Banner>}

      <Card>
        {sessions && sessions.length === 0 && (
          <Banner kind="brand">No help sessions yet — they appear when a student you assigned work to uses Ask for Help.</Banner>
        )}
        <ul className="people">
          {(sessions ?? []).map((s) => (
            <li className="person" key={s.sessionId}>
              <button className="linkish" onClick={() => open(s.sessionId)}><strong>{s.taskTitle}</strong></button>
              <span className="person__meta">{s.studentLabel}</span>
              <span className="spacer" />
              <span className="person__meta">{new Date(s.createdAt).toLocaleDateString()}</span>
            </li>
          ))}
        </ul>
      </Card>

      {openId && transcript && (
        <Card>
          <div className="card__head"><h2 className="section">Transcript</h2></div>
          <ul className="people">
            {transcript.map((m, i) => (
              <li className="person" key={i} style={{ alignItems: "flex-start" }}>
                <Chip state={m.role === "student" ? "pending" : "approved"}>{m.role === "student" ? "Student" : "Tutor"}</Chip>
                <span style={{ flex: 1 }}>{m.text}</span>
                <span className="person__meta">{m.kind}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </PageShell>
  );
}
