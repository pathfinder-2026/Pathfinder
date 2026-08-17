import { useCallback, useEffect, useState } from "react";
import { api, type Session } from "../api";
import { Banner, Button, Card, Chip, PageShell } from "../components";
import { NotificationBell } from "../NotificationBell";

/**
 * Review, edit and sign off the curricula a school teaches against.
 *
 * A curriculum drafted from a syllabus is AI-written: without a screen to READ
 * it, "sign off" would be a rubber stamp on 85 concepts nobody had seen. Editing
 * is deliberately draft-only — once signed off, mastery records and content
 * mappings reference these concepts, so rewording one would change the meaning
 * of evidence already collected.
 */
export function TeacherCurriculum({ session, displayName, onBack, onSignOut }: {
  session: Session; displayName: string; onBack: () => void; onSignOut: () => void;
}) {
  const [list, setList] = useState<Awaited<ReturnType<typeof api.curricula>> | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof api.curriculumDetail>> | null>(null);
  const [editing, setEditing] = useState<{ id: string; label: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try { setList(await api.curricula(session)); }
    catch (e) { setError((e as Error).message); }
  }, [session]);
  useEffect(() => { void refresh(); }, [refresh]);

  const open = async (versionId: string) => {
    if (openId === versionId) { setOpenId(null); setDetail(null); return; }
    setError(null); setOpenId(versionId); setDetail(null); setEditing(null);
    try { setDetail(await api.curriculumDetail(session, versionId)); }
    catch (e) { setError((e as Error).message); }
  };

  const act = async (fn: () => Promise<string>) => {
    setError(null); setNotice(null); setBusy(true);
    try {
      setNotice(await fn());
      if (openId) setDetail(await api.curriculumDetail(session, openId));
      await refresh();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const current = list?.find((c) => c.versionId === openId) ?? null;
  const isDraft = current?.status !== "signed_off";
  const conceptCount = (detail?.strands.reduce((n, s) => n + s.concepts.length, 0) ?? 0) + (detail?.orphans.length ?? 0);

  return (
    <PageShell topRight={<NotificationBell session={session} />} displayName={displayName} title="Curriculum"
      roleTag="Teacher" backLabel="Back to teacher home" onBack={onBack} onSignOut={onSignOut}
      lede="The subjects and concepts your school teaches against. A curriculum drafted from a syllabus is AI-written — read it against the source, fix anything wrong, then sign it off. Nothing can be taught or assessed against an unsigned curriculum.">
      {error && <Banner kind="error">{error}</Banner>}
      {notice && <Banner kind="brand">{notice}</Banner>}

      <Card>
        <div className="card__head">
          <h2 className="section">Curricula {list ? `— ${list.length}` : ""}</h2>
          <p className="muted">Draft a new one from an approved syllabus in Content Studio.</p>
        </div>
        {!list ? <div className="muted">Loading…</div>
          : list.length === 0 ? <Banner kind="brand">No curricula yet — approve a syllabus in Content Studio and draft one from it.</Banner>
          : (
            <ul className="people">
              {list.map((c) => (
                <li className="person" key={c.versionId} style={{ flexWrap: "wrap", gap: 10 }}>
                  <button className="linkish" onClick={() => void open(c.versionId)} aria-expanded={openId === c.versionId}>
                    <strong>{c.scopeLabel}</strong>
                  </button>
                  <span className="person__meta">{c.concepts} concepts</span>
                  <span className="spacer" />
                  {c.status === "signed_off"
                    ? <Chip state="approved">Signed off</Chip>
                    : <Chip state="draft">Draft — not yet usable</Chip>}
                </li>
              ))}
            </ul>
          )}
      </Card>

      {openId && current && (
        <Card>
          <div className="card__head">
            <h2 className="section">
              {current.scopeLabel}{" "}
              {isDraft ? <Chip state="draft">Draft</Chip> : <Chip state="approved">Signed off</Chip>}
            </h2>
            <p className="muted">
              {isDraft
                ? "Check these read like the syllabus. Reword anything clumsy, remove anything that isn't really a concept, then sign off."
                : "Signed off, so these are locked — mastery and content mappings already reference them. Import a new version to change the curriculum."}
            </p>
          </div>

          {!detail ? <div className="muted">Loading concepts…</div> : (
            <>
              {isDraft && (
                <Banner kind="warn">
                  This was drafted by AI from the syllabus document. Nothing has been checked against the source yet —
                  that's what you're doing here.
                </Banner>
              )}

              {detail.strands.map((s) => (
                <div key={s.id} style={{ marginBottom: 16 }}>
                  <h3 style={{ fontSize: 14, margin: "0 0 6px" }}>{s.label} <span className="person__meta">({s.concepts.length})</span></h3>
                  <ul className="people">
                    {s.concepts.map((c) => (
                      <li className="person" key={c.id} style={{ flexWrap: "wrap", gap: 8 }}>
                        {editing?.id === c.id ? (
                          <>
                            <input className="input" style={{ flex: 1, minWidth: 260 }} value={editing.label}
                              onChange={(e) => setEditing({ id: c.id, label: e.target.value })}
                              aria-label={`Reword ${c.label}`} />
                            <Button onClick={() => act(async () => {
                              await api.renameConcept(session, openId, c.id, editing.label);
                              setEditing(null);
                              return "Concept reworded.";
                            })} disabled={busy || !editing.label.trim()}>Save</Button>
                            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                          </>
                        ) : (
                          <>
                            <span style={{ flex: 1, minWidth: 240, fontSize: 13 }}>{c.label}</span>
                            {isDraft && (
                              <>
                                <Button variant="ghost" onClick={() => setEditing({ id: c.id, label: c.label })} disabled={busy}>Edit</Button>
                                <Button variant="ghost" onClick={() => act(async () => {
                                  const r = await api.removeConcept(session, openId, c.id);
                                  return `Removed ${r.removed} concept${r.removed === 1 ? "" : "s"}.`;
                                })} disabled={busy}>Remove</Button>
                              </>
                            )}
                          </>
                        )}
                      </li>
                    ))}
                    {s.concepts.length === 0 && <li className="person"><span className="muted">No concepts under this topic area.</span></li>}
                  </ul>
                </div>
              ))}

              {detail.orphans.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <h3 style={{ fontSize: 14, margin: "0 0 6px" }}>Other concepts <span className="person__meta">({detail.orphans.length})</span></h3>
                  <ul className="people">
                    {detail.orphans.map((c) => (
                      <li className="person" key={c.id}>
                        <span style={{ flex: 1, fontSize: 13 }}>{c.label}</span>
                        {isDraft && (
                          <Button variant="ghost" onClick={() => act(async () => {
                            const r = await api.removeConcept(session, openId, c.id);
                            return `Removed ${r.removed} concept${r.removed === 1 ? "" : "s"}.`;
                          })} disabled={busy}>Remove</Button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {isDraft && (
                <div className="btn-row">
                  <Button variant="primary" disabled={busy || conceptCount === 0} onClick={() => act(async () => {
                    const signed = await api.signOffCurriculum(session, openId);
                    return `${signed.subject} Year ${signed.yearLevel} signed off — its concepts are now available to teach and assess against.`;
                  })}>
                    Sign off this curriculum
                  </Button>
                  <span className="muted">
                    {conceptCount === 0
                      ? "Nothing left to sign off — every concept was removed."
                      : `${conceptCount} concepts will become available to every teacher.`}
                  </span>
                </div>
              )}
            </>
          )}
        </Card>
      )}
    </PageShell>
  );
}
