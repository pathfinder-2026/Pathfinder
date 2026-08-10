import { useApi } from "../api";
import { ErrorBox, Loading } from "../ui";

interface OverviewResp {
  school: { name: string };
  milestones: { id: string; name: string; detail: string; route: string }[];
}

export function Overview({ onGo }: { onGo: (route: string) => void }) {
  const { data, loading, error } = useApi<OverviewResp>("/overview");
  if (loading) return <Loading label="Preparing the demo school…" />;
  if (error || !data) return <ErrorBox message={error ?? "no data"} />;

  return (
    <>
      <div className="hero" style={{ marginBottom: 22 }}>
        <h2 style={{ margin: 0, fontSize: 22, letterSpacing: "-.02em" }}>Everything built so far</h2>
        <p>
          This is a preview of the <strong>{data.school.name}</strong> demo — the already-tested
          Milestones 0–5a rendered as clickable screens. Every number below is real output from the
          same services the 137-test suite exercises. Open the <strong>Teacher Dashboard</strong> to
          see the milestone-5a intelligence layer at work.
        </p>
      </div>

      <div className="grid grid-3">
        {data.milestones.map((m) => (
          <button key={m.id} className="card card-pad" style={{ textAlign: "left", cursor: "pointer", border: "1px solid var(--border)" }} onClick={() => onGo(m.route)}>
            <div className="spread" style={{ marginBottom: 10 }}>
              <span className="chip info">{m.id}</span>
              <span className="plain">Open →</span>
            </div>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{m.name}</div>
            <div className="small muted">{m.detail}</div>
          </button>
        ))}
      </div>

      <div className="pill-note" style={{ marginTop: 22 }}>
        <strong>Preview / validation build.</strong> Deliberately rough — not the production design
        system. It exists so you can click through and validate the milestones before the UI is built
        for real, milestone by milestone.
      </div>
    </>
  );
}
