import { useCallback, useEffect, useState } from "react";
import { api, ROLES, type Account, type Session } from "../api";
import { Banner, Button, Card, Chip, InviteLink, TopBar } from "../components";
import type { GovState } from "../components";

/**
 * Manage accounts — assign roles + edit names (FR-ADM-002; Principal per campus,
 * FR-ADM-007). Role changes take effect immediately; demoting the only admin is
 * blocked by the server and surfaced here.
 */
export function People({ session, displayName, onBack, onSignOut }: {
  session: Session; displayName: string; onBack: () => void; onSignOut: () => void;
}) {
  const [rows, setRows] = useState<Account[]>([]);
  const [campuses, setCampuses] = useState<{ id: string; name: string }[]>([]);
  const [pending, setPending] = useState<Awaited<ReturnType<typeof api.listInvites>>>([]);
  const [links, setLinks] = useState<Awaited<ReturnType<typeof api.listParentLinks>>>([]);
  const [linkForm, setLinkForm] = useState({ parentId: "", studentId: "", relationship: "parent" });
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ firstName: "", lastName: "" });

  const load = useCallback(async () => {
    const [a, c, inv, pl] = await Promise.all([api.accounts(session), api.campuses(session), api.listInvites(session), api.listParentLinks(session)]);
    setRows(a);
    setCampuses(c);
    setPending(inv.filter((i) => i.inviteToken));
    setLinks(pl);
  }, [session]);
  useEffect(() => { void load(); }, [load]);

  const changeRole = async (r: Account, role: string) => {
    setError(null);
    try {
      await api.changeRole(session, r.membershipId, role, role === "principal" ? r.campusId ?? campuses[0]?.id ?? null : r.campusId);
      await load();
    } catch (e) { setError((e as Error).message); }
  };

  const saveName = async (r: Account) => {
    setError(null);
    try {
      await api.updateName(session, r.userId, draft.firstName, draft.lastName);
      setEditing(null);
      await load();
    } catch (e) { setError((e as Error).message); }
  };

  const statusChip = (status: string): GovState => (status === "active" ? "approved" : "pending");

  return (
    <div className="app">
      <TopBar title={displayName} roleTag="Administrator · People" />
      <main className="main">
        <div className="container">
          <button className="linkish" onClick={onBack}>← Back to workspace</button>
          <h1 style={{ marginTop: 10 }}>People</h1>
          <p className="lede">Assign roles and edit names. Access updates immediately — no re-login needed.</p>
          {error && <Banner kind="error">{error}</Banner>}

          <Card>
            <ul className="people">
              {rows.map((r) => (
                <li className="person" key={r.membershipId} style={{ gap: 14, flexWrap: "wrap" }}>
                  <span className="person__avatar">{(r.firstName ?? "?").slice(0, 1)}{(r.lastName ?? "").slice(0, 1)}</span>
                  {editing === r.membershipId ? (
                    <span style={{ display: "flex", gap: 8, flex: 1, minWidth: 220 }}>
                      <input className="input" style={{ maxWidth: 130 }} value={draft.firstName} onChange={(e) => setDraft({ ...draft, firstName: e.target.value })} aria-label="First name" />
                      <input className="input" style={{ maxWidth: 130 }} value={draft.lastName} onChange={(e) => setDraft({ ...draft, lastName: e.target.value })} aria-label="Last name" />
                      <Button variant="primary" onClick={() => saveName(r)}>Save</Button>
                      <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                    </span>
                  ) : (
                    <>
                      <span style={{ minWidth: 150 }}>{r.firstName} {r.lastName}</span>
                      <span className="person__meta" style={{ flex: 1, minWidth: 160 }}>{r.email}</span>
                      <label className="person__meta" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        Role
                        <select className="select" style={{ width: "auto" }} value={r.role} onChange={(e) => changeRole(r, e.target.value)}>
                          {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
                        </select>
                      </label>
                      <Chip state={statusChip(r.status)}>{r.status === "active" ? "Active" : "Invited"}</Chip>
                      <button className="linkish" onClick={() => { setEditing(r.membershipId); setDraft({ firstName: r.firstName ?? "", lastName: r.lastName ?? "" }); }}>Edit name</button>
                    </>
                  )}
                </li>
              ))}
            </ul>
            <p className="muted" style={{ marginTop: 14 }}>Changing someone to <strong>Principal</strong> assigns them to a campus. The school's only administrator can't be demoted until another admin exists.</p>
          </Card>

          <Card>
            <div className="card__head">
              <h2 className="section">Parent–child links</h2>
              <p className="muted">A parent sees nothing until you link and <strong>verify</strong> their relationship to a child. Verification is the school vouching for the relationship (FR-PAR-003).</p>
            </div>
            <div className="row">
              <label className="field"><span className="field__label">Parent</span>
                <select className="select" value={linkForm.parentId} onChange={(e) => setLinkForm({ ...linkForm, parentId: e.target.value })}>
                  <option value="">Choose…</option>
                  {rows.filter((r) => r.role === "parent").map((r) => <option key={r.userId} value={r.userId}>{r.firstName} {r.lastName}</option>)}
                </select>
              </label>
              <label className="field"><span className="field__label">Child</span>
                <select className="select" value={linkForm.studentId} onChange={(e) => setLinkForm({ ...linkForm, studentId: e.target.value })}>
                  <option value="">Choose…</option>
                  {rows.filter((r) => r.role === "student").map((r) => <option key={r.userId} value={r.userId}>{r.firstName} {r.lastName}</option>)}
                </select>
              </label>
            </div>
            <Button onClick={async () => {
              setError(null);
              try { await api.createParentLink(session, linkForm.parentId, linkForm.studentId, linkForm.relationship); setLinkForm({ parentId: "", studentId: "", relationship: "parent" }); await load(); }
              catch (e) { setError((e as Error).message); }
            }} disabled={!linkForm.parentId || !linkForm.studentId}>Link (unverified)</Button>
            {links.length > 0 && (
              <ul className="people" style={{ marginTop: 14 }}>
                {links.map((l) => (
                  <li className="person" key={l.id}>
                    <span>{l.parentLabel} → {l.childLabel}</span>
                    <span className="person__meta">{l.relationship}</span>
                    <span className="spacer" />
                    {l.verified ? <Chip state="approved">Verified</Chip> : (
                      <>
                        <Chip state="pending">Unverified — no data flows</Chip>
                        <Button onClick={async () => { setError(null); try { await api.verifyParentLink(session, l.id); await load(); } catch (e) { setError((e as Error).message); } }}>Verify</Button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {pending.length > 0 && (
            <Card>
              <div className="card__head">
                <h2 className="section">Pending invites</h2>
                <p className="muted">No email is sent in this environment — copy each person's single-use link and share it with them directly. The link disappears once they accept.</p>
              </div>
              <ul className="people">
                {pending.map((p) => (
                  <li className="person" key={p.id}>
                    <span className="person__avatar">{(p.firstName ?? "?").slice(0, 1)}{(p.lastName ?? "").slice(0, 1)}</span>
                    <span>{p.firstName} {p.lastName}</span>
                    <span className="person__meta">{p.email} · {p.role}</span>
                    <span className="spacer" />
                    <InviteLink token={p.inviteToken!} />
                    <Chip state="pending">Invited</Chip>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <div className="btn-row">
            <span className="spacer" />
            <Button variant="ghost" onClick={onSignOut}>Sign out</Button>
          </div>
        </div>
      </main>
    </div>
  );
}
