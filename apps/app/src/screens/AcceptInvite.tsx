import { useEffect, useState, type FormEvent } from "react";
import { api, type Session } from "../api";
import { Banner, Button, Card, Field, TopBar } from "../components";

/**
 * S-AUTH-2 — an invited Teacher/Student/Parent/Principal opens their link
 * (?token=…), sees who invited them, sets a password, and gets a session.
 */
export function AcceptInvite({ token, onAccepted }: { token: string; onAccepted: (s: Session, roles: string[]) => void }) {
  const [invite, setInvite] = useState<{ role: string; status: string; schoolName: string | null; firstName: string | null } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getInvite(token).then(setInvite).catch((e) => setLoadError((e as Error).message));
  }, [token]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirm) { setError("Passwords don't match."); return; }
    setBusy(true);
    try {
      const res = await api.acceptInvite(token, password);
      onAccepted({ token: res.token, schoolId: res.schoolId, campusId: res.campusId ?? "" }, res.roles);
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="app">
      <TopBar title="Pathfinder" roleTag="Accept invitation" />
      <main className="main">
        <div className="container center">
          <div className="narrow">
            {loadError ? (
              <Card><Banner kind="error">This invitation link is invalid or has expired.</Banner></Card>
            ) : !invite ? (
              <div className="muted">Loading…</div>
            ) : invite.status !== "pending" ? (
              <Card><Banner kind="warn">This invitation has already been accepted. Please sign in instead.</Banner></Card>
            ) : (
              <>
                <p className="eyebrow">You're invited</p>
                <h1>Join {invite.schoolName ?? "your school"}</h1>
                <p className="lede">You've been invited as a <strong>{invite.role}</strong>. Set a password to get started.</p>
                <Card>
                  <form onSubmit={submit}>
                    {error && <Banner kind="error">{error}</Banner>}
                    <Field label="Create a password" hint="At least 8 characters." htmlFor="p1"><input id="p1" className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required /></Field>
                    <Field label="Confirm password" htmlFor="p2"><input id="p2" className="input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} minLength={8} required /></Field>
                    <div className="btn-row"><Button type="submit" variant="primary" disabled={busy}>{busy ? "Setting up…" : "Accept & continue"}</Button></div>
                  </form>
                </Card>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
