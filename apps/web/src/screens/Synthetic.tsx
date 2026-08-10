import { useApi } from "../api";
import { Card, ErrorBox, Loading, Stat } from "../ui";

interface SyntheticResp {
  count: number;
  thresholds: { smallCohortMax: number; stalenessDays: number; misconceptionEscalationMin: number; insufficientDataMin: number; revalidateAfterMilestone: number };
  quarantine: string[];
  students: { label: string; roles: string[] }[];
}

export function Synthetic() {
  const { data, loading, error } = useApi<SyntheticResp>("/synthetic");
  if (loading) return <Loading />;
  if (error || !data) return <ErrorBox message={error ?? "no data"} />;
  const t = data.thresholds;

  return (
    <>
      <div className="grid grid-4" style={{ marginBottom: 20 }}>
        <Stat k="Synthetic students" v={data.count} d="feeding the dashboard" accent />
        <Stat k="Small-cohort max" v={t.smallCohortMax} d="suppression threshold" />
        <Stat k="Staleness window" v={`${t.stalenessDays}d`} d="older data is flagged" />
        <Stat k="Escalation at" v={`${t.misconceptionEscalationMin}×`} d="repeated misconception" />
      </div>

      <div className="callout" style={{ marginBottom: 20 }}>
        Synthetic data is <strong>quarantined</strong> and its tuning thresholds are provisional —
        re-validated against real data after Milestone {t.revalidateAfterMilestone}.
      </div>

      <div className="grid grid-2">
        <Card>
          <div className="card-h"><h2>Quarantine rules</h2><span className="hint">enforced as requirements</span></div>
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
            {data.quarantine.map((q) => (
              <div key={q} className="row"><span style={{ color: "var(--secure-solid)", fontWeight: 800 }}>✓</span><span className="small">{q}</span></div>
            ))}
          </div>
        </Card>
        <Card>
          <div className="card-h"><h2>Planted edge cases</h2><span className="hint">what makes 5a testable</span></div>
          <table className="tbl" style={{ marginTop: 8 }}>
            <tbody>
              {data.students.filter((s) => s.roles.length > 0).map((s) => (
                <tr key={s.label}>
                  <td style={{ fontWeight: 600, width: 110 }}>{s.label}</td>
                  <td>{s.roles.map((r) => <span key={r} className="chip role" style={{ marginRight: 6 }}>{r}</span>)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </>
  );
}
