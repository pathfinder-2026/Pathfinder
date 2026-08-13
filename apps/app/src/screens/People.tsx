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
  const [handover, setHandover] = useState({ from: "", to: "" });
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ firstName: "", lastName: "" });

  const [classes, setClasses] = useState<{ id: string; name: string }[]>([]);

  const load = useCallback(async () => {
    const [a, c, inv, pl, cls] = await Promise.all([
      api.accounts(session), api.campuses(session), api.listInvites(session), api.listParentLinks(session), api.listClasses(session),
    ]);
    setRows(a);
    setCampuses(c);
    setPending(inv.filter((i) => i.inviteToken));
    setLinks(pl);
    setClasses(cls);
  }, [session]);
  useEffect(() => { void load(); }, [load]);

  const changeRole = async (r: Account, role: string) => {
    setError(null);
    try {
      await api.changeRole(session, r.membershipId, role, role === "principal" ? r.campusId ?? campuses[0]?.id ?? null : r.campusId, r.classId);
      await load();
    } catch (e) { setError((e as Error).message); }
  };

  /** Assign a teacher or student to a class (FR-ADM-002; the class dashboard,
   *  adaptive escalations and year-group calendar all key off this). */
  const changeClass = async (r: Account, classId: string) => {
    setError(null);
    try {
      await api.changeRole(session, r.membershipId, r.role, r.campusId, classId || null);
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
          {notice && <Banner kind="brand">{notice}</Banner>}

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
                      {(r.role === "teacher" || r.role === "student") && (
                        <label className="person__meta" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          Class
                          <select className="select" style={{ width: "auto" }} value={r.classId ?? ""} onChange={(e) => changeClass(r, e.target.value)} aria-label={`Class for ${r.firstName ?? "person"}`}>
                            <option value="">None</option>
                            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        </label>
                      )}
                      <Chip state={statusChip(r.status)}>{r.status === "active" ? "Active" : "Invited"}</Chip>
                      <button className="linkish" onClick={() => { setEditing(r.membershipId); setDraft({ firstName: r.firstName ?? "", lastName: r.lastName ?? "" }); }}>Edit name</button>
                    </>
                  )}
                </li>
              ))}
            </ul>
            <p className="muted" style={{ marginTop: 14 }}>Teachers and students are assigned to a <strong>class</strong> here — the class dashboard, adaptive escalations and year-group calendars all key off it. Changing someone to <strong>Principal</strong> assigns them to a campus. The school's only administrator can't be demoted until another admin exists.</p>
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

          <Card>
            <div className="card__head">
              <h2 className="section">Absence cover — hand a class over</h2>
              <p className="muted">
                When a teacher is away, hand their class to a covering teacher. The covering teacher gets everything
                through <strong>their own login</strong> — the class dashboards, the absent teacher's assigned tasks,
                and the Ask-for-Help transcripts (which follow the tasks). Logins are never shared: every action stays
                attributed to the person who took it. Reversible by handing back.
              </p>
            </div>
            <div className="row">
              <label className="field"><span className="field__label">Absent teacher</span>
                <select className="select" value={handover.from} onChange={(e) => setHandover({ ...handover, from: e.target.value })}>
                  <option value="">Choose…</option>
                  {rows.filter((r) => r.role === "teacher").map((r) => (
                    <option key={r.userId} value={r.userId}>{r.firstName} {r.lastName}{r.classId ? ` — ${classes.find((c) => c.id === r.classId)?.name ?? "class"}` : " (no class)"}</option>
                  ))}
                </select>
              </label>
              <label className="field"><span className="field__label">Covering teacher</span>
                <select className="select" value={handover.to} onChange={(e) => setHandover({ ...handover, to: e.target.value })}>
                  <option value="">Choose…</option>
                  {rows.filter((r) => r.role === "teacher" && r.userId !== handover.from).map((r) => (
                    <option key={r.userId} value={r.userId}>{r.firstName} {r.lastName}</option>
                  ))}
                </select>
              </label>
            </div>
            <Button variant="primary" disabled={!handover.from || !handover.to} onClick={async () => {
              setError(null); setNotice(null);
              try {
                const r = await api.handoverClass(session, handover.from, handover.to);
                setNotice(`Handed over: ${r.classId ? "class reassigned, " : ""}${r.tasksTransferred} task(s) and ${r.helpSessionsTransferred} help transcript(s) now belong to the covering teacher.`);
                setHandover({ from: "", to: "" });
                await load();
              } catch (e) { setError((e as Error).message); }
            }}>Hand over</Button>
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
