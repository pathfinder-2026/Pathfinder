import { useCallback, useEffect, useState } from "react";
import { api, type Session } from "./api";
import { Banner, Button, Chip } from "./components";

/**
 * Review and sign off a curriculum, inline where it was drafted.
 *
 * Deliberately not a separate destination: the loop is approve syllabus → draft
 * curriculum → read it → sign off, and it all belongs to the document the
 * teacher is already looking at. Sending them elsewhere to finish breaks the
 * one flow they came here for.
 *
 * Editing is draft-only. Once signed off, mastery records and content mappings
 * reference these concepts, so rewording one would change the meaning of
 * evidence already collected.
 */
export function CurriculumReview({ session, versionId, onChanged }: {
  session: Session;
  versionId: string;
  onChanged?: () => void;
}) {
  const [meta, setMeta] = useState<Awaited<ReturnType<typeof api.curricula>>[number] | null>(null);
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof api.curriculumDetail>> | null>(null);
  const [editing, setEditing] = useState<{ id: string; label: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [all, d] = await Promise.all([api.curricula(session), api.curriculumDetail(session, versionId)]);
      setMeta(all.find((c) => c.versionId === versionId) ?? null);
      setDetail(d);
    } catch (e) { setError((e as Error).message); }
  }, [session, versionId]);
  useEffect(() => { void load(); }, [load]);

  const act = async (fn: () => Promise<string>) => {
    setError(null); setNotice(null); setBusy(true);
    try { setNotice(await fn()); await load(); onChanged?.(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  if (!detail || !meta) return <p className="muted">Loading curriculum…</p>;
  const isDraft = meta.status !== "signed_off";
  const total = detail.strands.reduce((n, s) => n + s.concepts.length, 0) + detail.orphans.length;

  return (
    <div style={{ marginTop: 12, borderTop: "1px solid var(--pf-border)", paddingTop: 12 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
        <strong>{meta.scopeLabel} curriculum</strong>
        {isDraft ? <Chip state="draft">Draft — not yet usable</Chip> : <Chip state="approved">Signed off</Chip>}
        <span className="person__meta">{total} concepts</span>
      </div>

      {error && <Banner kind="error">{error}</Banner>}
      {notice && <Banner kind="brand">{notice}</Banner>}
      {isDraft && (
        <Banner kind="warn">
          Drafted by AI from this syllabus and not checked against it yet — that's what you're doing here.
          Reword anything clumsy, remove anything that isn't really a concept, then sign off.
        </Banner>
      )}

      {detail.strands.map((s) => (
        <div key={s.id} style={{ marginBottom: 14 }}>
          <h4 style={{ fontSize: 13, margin: "0 0 4px" }}>{s.label} <span className="person__meta">({s.concepts.length})</span></h4>
          <ul className="people">
            {s.concepts.map((c) => (
              <li className="person" key={c.id} style={{ flexWrap: "wrap", gap: 8 }}>
                {editing?.id === c.id ? (
                  <>
                    <input className="input" style={{ flex: 1, minWidth: 240 }} value={editing.label}
                      onChange={(e) => setEditing({ id: c.id, label: e.target.value })} aria-label={`Reword ${c.label}`} />
                    <Button disabled={busy || !editing.label.trim()} onClick={() => act(async () => {
                      await api.renameConcept(session, versionId, c.id, editing.label);
                      setEditing(null);
                      return "Concept reworded.";
                    })}>Save</Button>
                    <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                  </>
                ) : (
                  <>
                    <span style={{ flex: 1, minWidth: 220, fontSize: 13 }}>{c.label}</span>
                    {isDraft && (
                      <>
                        <Button variant="ghost" disabled={busy} onClick={() => setEditing({ id: c.id, label: c.label })}>Edit</Button>
                        <Button variant="ghost" disabled={busy} onClick={() => act(async () => {
                          const r = await api.removeConcept(session, versionId, c.id);
                          return `Removed ${r.removed} concept${r.removed === 1 ? "" : "s"}.`;
                        })}>Remove</Button>
                      </>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}

      {detail.orphans.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <h4 style={{ fontSize: 13, margin: "0 0 4px" }}>Other concepts <span className="person__meta">({detail.orphans.length})</span></h4>
          <ul className="people">
            {detail.orphans.map((c) => (
              <li className="person" key={c.id}>
                <span style={{ flex: 1, fontSize: 13 }}>{c.label}</span>
                {isDraft && (
                  <Button variant="ghost" disabled={busy} onClick={() => act(async () => {
                    const r = await api.removeConcept(session, versionId, c.id);
                    return `Removed ${r.removed} concept${r.removed === 1 ? "" : "s"}.`;
                  })}>Remove</Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {isDraft && (
        <div className="btn-row">
          <Button variant="primary" disabled={busy || total === 0} onClick={() => act(async () => {
            const signed = await api.signOffCurriculum(session, versionId);
            return `${signed.subject} Year ${signed.yearLevel} signed off — its concepts are now available to teach and assess against.`;
          })}>Sign off this curriculum</Button>
          <span className="muted">
            {total === 0 ? "Nothing left to sign off." : `${total} concepts will become available to every teacher.`}
          </span>
        </div>
      )}
    </div>
  );
}
