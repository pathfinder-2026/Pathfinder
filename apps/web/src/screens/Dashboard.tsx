import { useState } from "react";
import { api, useApi } from "../api";
import { Card, ErrorBox, Loading, Stat } from "../ui";

interface Cell { studentId: string; studentLabel: string; nodeId: string; skill: string; level: string; score: number; trend: string; insufficientData: boolean; stale: boolean; }
interface DashboardResp {
  class: { name: string };
  emptyClass: { name: string; enoughData: boolean };
  skills: { id: string; label: string }[];
  students: { id: string; label: string; roles: string[] }[];
  heatmap: { enoughData: boolean; cells: Cell[]; flags: { student: string; skill: string; kind: string }[] };
  focusAreas: { skill: string; belowCount: number; total: number; belowFraction: number; contentGap: boolean; suggestedMaterial: string[] }[];
  groups: { type: string; label: string; skill: string | null; basis: string; staleNote: string | null; students: string[] }[];
  escalations: { student: string; skill: string; misconception: string; occurrences: number }[];
  reminders: { total: number; deferred: number; sample: { student: string; skill: string; deferred: boolean; reason: string | null }[] };
  recommendations: { student: string; skill: string; action: string; reason: string; escalated: boolean }[];
}

const TREND_GLYPH: Record<string, string> = { down: "↓", up: "↑", flat: "" };

export function Dashboard() {
  const { data, loading, error, reload } = useApi<DashboardResp>("/dashboard");
  const [busy, setBusy] = useState<string | null>(null);
  if (loading) return <Loading label="Computing class intelligence…" />;
  if (error || !data) return <ErrorBox message={error ?? "no data"} />;

  const cellMap = new Map<string, Cell>();
  for (const c of data.heatmap.cells) cellMap.set(`${c.studentId}::${c.nodeId}`, c);

  async function dismiss(skill: string) {
    setBusy(skill);
    await api.post("/dashboard/focus/dismiss", { skillLabel: skill });
    setBusy(null);
    reload();
  }

  return (
    <>
      <div className="grid grid-4" style={{ marginBottom: 4 }}>
        <Stat k="Students tracked" v={data.students.length} d="synthetic cohort (no PII)" accent />
        <Stat k="Skills with data" v={data.skills.length} d="across the mapped graph" />
        <Stat k="Class focus areas" v={data.focusAreas.length} d={`${data.focusAreas.filter((f) => f.contentGap).length} with a content gap`} />
        <Stat k="Escalations" v={data.escalations.length} d="persistent misconceptions" />
      </div>

      {/* ---- Heatmap ---- */}
      <div className="section-title">Mastery heatmap · {data.class.name}</div>
      <div className="heat-wrap">
        <table className="heat">
          <thead>
            <tr>
              <th className="corner"></th>
              {data.skills.map((s) => (
                <th key={s.id} className="skill" title={s.label}>{s.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.students.map((stud) => (
              <tr key={stud.id}>
                <td className="stud" title={stud.roles.join(", ")}>
                  {stud.label}{stud.roles.length > 0 && <span style={{ color: "var(--muted-2)" }}> •</span>}
                </td>
                {data.skills.map((s) => {
                  const c = cellMap.get(`${stud.id}::${s.id}`);
                  if (!c) return <td key={s.id}><div className="cell" style={{ background: "var(--surface-2)" }} /></td>;
                  const cls = c.insufficientData ? "insufficient" : c.level;
                  return (
                    <td key={s.id}>
                      <div className={`cell ${cls} ${c.stale ? "stale" : ""}`} title={`${stud.label} · ${c.skill}\nScore ${Math.round(c.score * 100)} · ${c.level}${c.stale ? " · stale" : ""}${c.insufficientData ? " · insufficient data" : ""}${c.trend !== "flat" ? " · trend " + c.trend : ""}`}>
                        {c.insufficientData ? "?" : Math.round(c.score * 100)}
                        {c.trend !== "flat" && <span className={`trend ${c.trend}`}>{TREND_GLYPH[c.trend]}</span>}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="legend">
        <span><span className="sw" style={{ background: "var(--low-bg)" }} />Low</span>
        <span><span className="sw" style={{ background: "var(--dev-bg)" }} />Developing</span>
        <span><span className="sw" style={{ background: "var(--secure-bg)" }} />Secure</span>
        <span><span className="sw" style={{ background: "repeating-linear-gradient(45deg,#f1f5f9,#f1f5f9 3px,#e2e8f0 3px,#e2e8f0 6px)" }} />Insufficient data (?)</span>
        <span><span className="sw" style={{ outline: "2px dashed var(--muted-2)", outlineOffset: "-3px" }} />Stale</span>
        <span>↓ / ↑ trend across assessments</span>
      </div>
      <div className="pill-note" style={{ marginTop: 14 }}>
        A brand-new class (<strong>{data.emptyClass.name}</strong>) with no completed work shows a clear
        “not enough data yet” state — {data.emptyClass.enoughData ? "has data" : "confirmed empty, no misleading grid"}.
      </div>

      {/* ---- Focus areas + cohorts ---- */}
      <div className="grid grid-2" style={{ marginTop: 22 }}>
        <div>
          <div className="section-title" style={{ marginTop: 0 }}>Class focus areas</div>
          <div className="grid" style={{ gap: 12 }}>
            {data.focusAreas.map((f) => (
              <div key={f.skill} className={`focus ${f.contentGap ? "gap" : "material"}`}>
                <div className="spread">
                  <strong>{f.skill}</strong>
                  {f.contentGap
                    ? <span className="chip warn">Content gap</span>
                    : <span className="chip info">Material ready</span>}
                </div>
                <div className="meter"><span style={{ width: `${Math.round(f.belowFraction * 100)}%` }} /></div>
                <div className="small muted">{f.belowCount} of {f.total} students below mastery ({Math.round(f.belowFraction * 100)}%)</div>
                {f.contentGap
                  ? <div className="small">No approved content addresses this — create material manually.</div>
                  : <div className="small">Reteach with: {f.suggestedMaterial.map((m) => <span key={m} className="chip" style={{ marginRight: 6 }}>{m}</span>)}</div>}
                <div className="row">
                  <button className="btn sm" disabled={busy === f.skill} onClick={() => dismiss(f.skill)}>
                    {busy === f.skill ? "Dismissing…" : "Dismiss suggestion"}
                  </button>
                  <span className="small muted">draft — needs an explicit teacher action</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="section-title" style={{ marginTop: 0 }}>Suggested cohorts</div>
          <div className="grid" style={{ gap: 12 }}>
            {data.groups.map((g, i) => (
              <Card key={i}>
                <div className="spread" style={{ marginBottom: 8 }}>
                  <div className="row">
                    <strong style={{ textTransform: "capitalize" }}>{g.label}</strong>
                    {g.skill && <span className="chip">{g.skill}</span>}
                  </div>
                  {g.basis === "stale" && <span className="chip warn">Older data</span>}
                </div>
                <div className="row">
                  {g.students.map((s) => <span key={s} className="chip role">{s}</span>)}
                </div>
                {g.staleNote && <div className="small muted" style={{ marginTop: 8 }}>{g.staleNote}</div>}
              </Card>
            ))}
          </div>
        </div>
      </div>

      {/* ---- Adaptive engine ---- */}
      <div className="section-title">Adaptive engine · next best action</div>
      <div className="grid grid-2">
        {data.recommendations.map((r, i) => (
          <div key={i} className={`reco ${r.escalated ? "escalate" : ""}`}>
            <div className="spread" style={{ marginBottom: 6 }}>
              <div className="row">
                <span className="avatar">{r.student.replace(/[^0-9]/g, "")}</span>
                <strong className="small">{r.student}</strong>
                <span className="chip">{r.skill}</span>
              </div>
              <span className={`act`} style={{ color: r.escalated ? "#dc2626" : "var(--brand-700)" }}>{r.action}</span>
            </div>
            <div className="small muted">{r.reason}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-2" style={{ marginTop: 22 }}>
        <Card>
          <div className="card-h"><h2>Escalated to you</h2><span className="hint">persistent misconceptions</span></div>
          {data.escalations.map((e, i) => (
            <div key={i} className="list-item">
              <span className="dot" style={{ background: "#dc2626" }} />
              <div>
                <div className="small"><strong>{e.student}</strong> · {e.skill}</div>
                <div className="small muted">“{e.misconception}” — seen {e.occurrences}× · handed to the teacher, not auto-remediated</div>
              </div>
            </div>
          ))}
        </Card>
        <Card>
          <div className="card-h"><h2>Spaced revision</h2><span className="hint">{data.reminders.deferred} of {data.reminders.total} deferred</span></div>
          <p className="small muted" style={{ marginTop: 0 }}>Reminders that would fire while a student is mid-assessment are deferred, never interrupting it.</p>
          {data.reminders.sample.map((r, i) => (
            <div key={i} className="list-item">
              <span className="dot" style={{ background: r.deferred ? "#f59e0b" : "var(--secure-solid)" }} />
              <div>
                <div className="small"><strong>{r.student}</strong> · {r.skill}</div>
                <div className="small muted">{r.deferred ? r.reason : "Due now"}</div>
              </div>
            </div>
          ))}
        </Card>
      </div>
    </>
  );
}
