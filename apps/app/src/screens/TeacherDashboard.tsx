import { useCallback, useEffect, useState } from "react";
import { api, type HeatmapData, type Session } from "../api";
import { Banner, Card, Field, PageShell } from "../components";

const TREND_GLYPH: Record<string, string> = { up: "↑", down: "↓", flat: "→" };

/**
 * TCH-6 — the class mastery heatmap (student × skill). Meaning is never encoded
 * by colour alone: every cell carries its level as text, a trend glyph, and
 * intervention/extension markers; insufficient-data and stale cells say so.
 */
export function TeacherDashboard({ session, displayName, onBack, onSignOut }: {
  session: Session; displayName: string; onBack: () => void; onSignOut: () => void;
}) {
  const [classes, setClasses] = useState<{ id: string; name: string }[] | null>(null);
  const [classId, setClassId] = useState("");
  const [data, setData] = useState<HeatmapData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.teacherClasses(session).then((cs) => {
      setClasses(cs);
      if (cs.length > 0) setClassId(cs[0].id);
    }).catch((e) => setError((e as Error).message));
  }, [session]);

  const load = useCallback(async (id: string) => {
    if (!id) return;
    setLoading(true); setError(null);
    try { setData(await api.heatmap(session, id)); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [session]);

  useEffect(() => { void load(classId); }, [classId, load]);

  const flagFor = (studentId: string, nodeId: string) =>
    data?.flags.find((f) => f.studentId === studentId && f.nodeId === nodeId)?.kind ?? null;
  const cellFor = (studentId: string, nodeId: string) =>
    data?.cells.find((c) => c.studentId === studentId && c.nodeId === nodeId) ?? null;

  return (
    <PageShell displayName={displayName} title="Class dashboard" roleTag="Teacher" backLabel="Back to teacher home"
      onBack={onBack} onSignOut={onSignOut}
      lede="Mastery by student and skill, with trend and intervention/extension flags. Cells with too little data say so — no invented signal.">
      {error && <Banner kind="error">{error}</Banner>}

      <Card>
        <Field label="Class" htmlFor="class-select">
          <select id="class-select" className="select" style={{ maxWidth: 340 }} value={classId} onChange={(e) => setClassId(e.target.value)}>
            {(classes ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        {classes && classes.length === 0 && <div className="muted">No classes yet — your administrator can add them under School structure.</div>}
      </Card>

      {loading ? <Card><div className="muted">Loading heatmap…</div></Card>
        : data && !data.enoughData ? (
          <Card>
            <Banner kind="brand">Not enough activity data in {data.class.name} yet. The heatmap will appear once students have worked on assigned material.</Banner>
          </Card>
        ) : data && (
          <Card>
            <div className="card__head">
              <h2 className="section">{data.class.name}</h2>
              <p className="muted">{data.students.length} students × {data.skills.length} skills · ↑ improving · ↓ declining · ● needs intervention · ★ extension-ready</p>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table className="heatmap" aria-label={`Mastery heatmap for ${data.class.name}`}>
                <thead>
                  <tr>
                    <th scope="col">Student</th>
                    {data.skills.map((s) => <th key={s.id} scope="col">{s.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {data.students.map((st) => (
                    <tr key={st.id}>
                      <th scope="row">{st.label}</th>
                      {data.skills.map((sk) => {
                        const cell = cellFor(st.id, sk.id);
                        const flag = flagFor(st.id, sk.id);
                        if (!cell || cell.insufficientData) {
                          return <td key={sk.id} className="hm hm--none"><span className="muted">no data</span></td>;
                        }
                        return (
                          <td key={sk.id} className={`hm hm--${cell.level}${cell.stale ? " hm--stale" : ""}`}>
                            <span className="hm__level">{cell.level}</span>
                            <span aria-hidden="true"> {TREND_GLYPH[cell.trend] ?? ""}</span>
                            {flag === "intervention" && <span title="Needs intervention" aria-label="needs intervention"> ●</span>}
                            {flag === "extension" && <span title="Extension-ready" aria-label="extension-ready"> ★</span>}
                            {cell.stale && <span className="hm__stale">stale</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
    </PageShell>
  );
}
