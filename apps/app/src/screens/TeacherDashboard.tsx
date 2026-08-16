import { useCallback, useEffect, useState } from "react";
import { api, type HeatmapData, type Session } from "../api";
import { Banner, Card, Field, PageShell } from "../components";
import { MasteryDistribution } from "../MasteryDistribution";

const TREND_GLYPH: Record<string, string> = { up: "↑", down: "↓", flat: "→" };

/**
 * TCH-6 — the class mastery heatmap (student × skill). Meaning is never encoded
 * by colour alone: every cell carries its level as text, a trend glyph, and
 * intervention/extension markers; insufficient-data and stale cells say so.
 */
export function TeacherDashboard({ session, displayName, onBack, onSignOut, onOpenInsights }: {
  session: Session; displayName: string; onBack: () => void; onSignOut: () => void; onOpenInsights?: () => void;
}) {
  const [classes, setClasses] = useState<{ id: string; name: string }[] | null>(null);
  const [classId, setClassId] = useState("");
  const [data, setData] = useState<HeatmapData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Slicing is client-side: the heatmap payload already holds every cell, so
  // filtering here avoids a round trip per adjustment.
  const [skillFilter, setSkillFilter] = useState("");
  const [bandFilter, setBandFilter] = useState("");
  const [trendFilter, setTrendFilter] = useState("");
  const [flagFilter, setFlagFilter] = useState("");
  const [sortBy, setSortBy] = useState<"name" | "mastery">("name");
  const [chartNodeId, setChartNodeId] = useState("");

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

  // Reset slicing when the class changes — a filter carried across classes
  // silently hides students the teacher just asked to see.
  useEffect(() => {
    setSkillFilter(""); setBandFilter(""); setTrendFilter(""); setFlagFilter(""); setChartNodeId("");
  }, [classId]);

  const skillsShown = (data?.skills ?? []).filter((s) => !skillFilter || s.id === skillFilter);

  /** A student row survives if ANY of its shown cells matches every active filter. */
  const matches = (studentId: string) => {
    if (!bandFilter && !trendFilter && !flagFilter) return true;
    return skillsShown.some((s) => {
      const cell = cellFor(studentId, s.id);
      const flag = flagFor(studentId, s.id);
      if (bandFilter && (bandFilter === "none" ? !!cell : cell?.level !== bandFilter)) return false;
      if (trendFilter && cell?.trend !== trendFilter) return false;
      if (flagFilter && flag !== flagFilter) return false;
      return true;
    });
  };

  const avgFor = (studentId: string) => {
    const scores = skillsShown.map((s) => cellFor(studentId, s.id)?.score).filter((n): n is number => n != null);
    return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : -1; // no data sorts last
  };

  const studentsShown = (data?.students ?? [])
    .filter((st) => matches(st.id))
    .sort((a, b) => (sortBy === "mastery" ? avgFor(a.id) - avgFor(b.id) : a.label.localeCompare(b.label)));

  const filtersActive = !!(skillFilter || bandFilter || trendFilter || flagFilter);

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
        {onOpenInsights && (
          <div className="btn-row" style={{ marginTop: 10 }}>
            <button className="linkish" onClick={onOpenInsights}>Open Class insights (focus areas · groups · next actions) →</button>
          </div>
        )}
      </Card>

      {data && data.enoughData && (
        <Card>
          <div className="card__head">
            <h2 className="section">Whole class, one skill</h2>
            <p className="muted">Pick a skill to see how the class sits across mastery bands before drilling into individuals.</p>
          </div>
          <Field label="Skill" htmlFor="chart-skill">
            <select id="chart-skill" className="select" style={{ maxWidth: 420 }} value={chartNodeId} onChange={(e) => setChartNodeId(e.target.value)}>
              <option value="">Choose a skill…</option>
              {data.skills.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </Field>
          {chartNodeId
            ? <MasteryDistribution data={data} nodeId={chartNodeId} />
            : <p className="muted">No skill selected yet.</p>}
        </Card>
      )}

      {loading ? <Card><div className="muted">Loading heatmap…</div></Card>
        : data && !data.enoughData ? (
          <Card>
            <Banner kind="brand">Not enough activity data in {data.class.name} yet. The heatmap will appear once students have worked on assigned material.</Banner>
          </Card>
        ) : data && (
          <Card>
            <div className="card__head">
              <h2 className="section">{data.class.name}</h2>
              <p className="muted">
                {filtersActive
                  ? `${studentsShown.length} of ${data.students.length} students × ${skillsShown.length} of ${data.skills.length} skills shown`
                  : `${data.students.length} students × ${data.skills.length} skills`}
                {" · ↑ improving · ↓ declining · ● needs intervention · ★ extension-ready · "}
                <em>early</em> = too few data points to lean on yet
              </p>
            </div>

            {/* Filters sit in one row above the grid; they only ever narrow what
                is shown — they never change a cell's meaning or hide its caveats. */}
            <div className="row">
              <Field label="Skill" htmlFor="f-skill">
                <select id="f-skill" className="select" value={skillFilter} onChange={(e) => setSkillFilter(e.target.value)}>
                  <option value="">All skills</option>
                  {data.skills.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </Field>
              <Field label="Mastery" htmlFor="f-band">
                <select id="f-band" className="select" value={bandFilter} onChange={(e) => setBandFilter(e.target.value)}>
                  <option value="">Any</option>
                  <option value="low">Below mastery</option>
                  <option value="developing">Developing</option>
                  <option value="secure">Secure</option>
                  <option value="none">No data yet</option>
                </select>
              </Field>
              <Field label="Trend" htmlFor="f-trend">
                <select id="f-trend" className="select" value={trendFilter} onChange={(e) => setTrendFilter(e.target.value)}>
                  <option value="">Any</option>
                  <option value="up">Improving</option>
                  <option value="down">Declining</option>
                  <option value="flat">Flat</option>
                </select>
              </Field>
              <Field label="Flag" htmlFor="f-flag">
                <select id="f-flag" className="select" value={flagFilter} onChange={(e) => setFlagFilter(e.target.value)}>
                  <option value="">Any</option>
                  <option value="intervention">Needs intervention</option>
                  <option value="extension">Extension-ready</option>
                </select>
              </Field>
              <Field label="Sort by" htmlFor="f-sort">
                <select id="f-sort" className="select" value={sortBy} onChange={(e) => setSortBy(e.target.value as "name" | "mastery")}>
                  <option value="name">Name</option>
                  <option value="mastery">Mastery (lowest first)</option>
                </select>
              </Field>
            </div>
            {filtersActive && (
              <div className="btn-row" style={{ marginTop: 0 }}>
                <button className="linkish" onClick={() => { setSkillFilter(""); setBandFilter(""); setTrendFilter(""); setFlagFilter(""); }}>
                  Clear filters
                </button>
              </div>
            )}
            {studentsShown.length === 0 && (
              <Banner kind="brand">No students match these filters — every student is outside the slice you asked for.</Banner>
            )}

            <div style={{ overflowX: "auto" }}>
              <table className="heatmap" aria-label={`Mastery heatmap for ${data.class.name}`}>
                <thead>
                  <tr>
                    <th scope="col">Student</th>
                    {skillsShown.map((s) => <th key={s.id} scope="col">{s.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {studentsShown.map((st) => (
                    <tr key={st.id}>
                      <th scope="row">{st.label}</th>
                      {skillsShown.map((sk) => {
                        const cell = cellFor(st.id, sk.id);
                        const flag = flagFor(st.id, sk.id);
                        // Only a genuinely absent record is "no data". A single
                        // data point IS a signal — hiding it here while the
                        // adaptive panel recommends from it made the dashboard
                        // contradict itself, so it shows, caveated as early.
                        if (!cell) {
                          return <td key={sk.id} className="hm hm--none"><span className="muted">no data yet</span></td>;
                        }
                        const early = cell.evidence === "early";
                        return (
                          <td key={sk.id} className={`hm hm--${cell.level}${cell.stale ? " hm--stale" : ""}`}
                            title={early ? `Early signal — ${cell.dataPoints} data point${cell.dataPoints === 1 ? "" : "s"} so far` : undefined}>
                            <span className="hm__level" style={early ? { opacity: 0.65 } : undefined}>{cell.level}</span>
                            <span aria-hidden="true"> {TREND_GLYPH[cell.trend] ?? ""}</span>
                            {flag === "intervention" && <span title="Needs intervention" aria-label="needs intervention"> ●</span>}
                            {flag === "extension" && <span title="Extension-ready" aria-label="extension-ready"> ★</span>}
                            {early && <span className="hm__stale" aria-label={`early signal, ${cell.dataPoints} data point`}>early · {cell.dataPoints}pt</span>}
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
