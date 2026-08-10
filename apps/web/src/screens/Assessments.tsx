import { useState } from "react";
import { api, useApi } from "../api";
import { Card, ErrorBox, Loading, StatusBadge } from "../ui";

interface AssessmentsResp {
  assessments: {
    id: string; title: string; status: string; skill: string; questionCount: number;
    shortfall: { requested: number; generated: number; reason: string } | null;
    reviewAcknowledged: boolean;
  }[];
}

export function Assessments() {
  const { data, loading, error, reload } = useApi<AssessmentsResp>("/assessments");
  const [busy, setBusy] = useState<string | null>(null);
  if (loading) return <Loading />;
  if (error || !data) return <ErrorBox message={error ?? "no data"} />;

  async function publish(id: string) {
    setBusy(id);
    try { await api.post(`/assessments/${id}/publish`); } catch { /* surfaced by reload */ }
    setBusy(null);
    reload();
  }

  return (
    <>
      <div className="pill-note" style={{ marginBottom: 20 }}>
        Generation is grounded <strong>only</strong> in approved content — never fabricated. Everything
        stays a <strong>draft</strong> until a teacher reviews and publishes it.
      </div>
      <Card>
        <div className="card-h"><h2>Assessments</h2><span className="hint">draft until published</span></div>
        <table className="tbl" style={{ marginTop: 10 }}>
          <thead>
            <tr><th>Title</th><th>Skill</th><th>Questions</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            {data.assessments.map((a) => (
              <tr key={a.id}>
                <td style={{ fontWeight: 600 }}>
                  {a.title}
                  {a.shortfall && <div className="small muted">shortfall: {a.shortfall.generated}/{a.shortfall.requested} — {a.shortfall.reason}</div>}
                </td>
                <td><span className="chip">{a.skill}</span></td>
                <td>{a.questionCount}</td>
                <td><StatusBadge status={a.status} /></td>
                <td style={{ textAlign: "right" }}>
                  {a.status === "draft"
                    ? <button className="btn primary sm" disabled={busy === a.id} onClick={() => publish(a.id)}>{busy === a.id ? "Publishing…" : "Review & publish"}</button>
                    : <span className="small muted">live</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
