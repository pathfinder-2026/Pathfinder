import { useApi } from "../api";
import { Card, ErrorBox, Loading, Stat, StatusBadge } from "../ui";

interface SkillGraphResp {
  version: { name: string; status: string; signedOffBy: string | null };
  counts: { nodes: number; edges: number };
  byType: Record<string, { id: string; label: string; code?: string }[]>;
}

const TYPE_ORDER = ["subject", "strand", "outcome", "topic", "concept", "skill", "subskill"];

export function SkillGraph() {
  const { data, loading, error } = useApi<SkillGraphResp>("/skillgraph");
  if (loading) return <Loading />;
  if (error || !data) return <ErrorBox message={error ?? "no data"} />;

  const types = TYPE_ORDER.filter((t) => data.byType[t]?.length);

  return (
    <>
      <div className="grid grid-4" style={{ marginBottom: 20 }}>
        <Stat k="Graph version" v={data.version.name} d="NSW Year 8 Maths" accent />
        <Stat k="Governance" v={<StatusBadge status={data.version.status} />} d={data.version.signedOffBy ? "signed off by an expert" : "unsigned"} />
        <Stat k="Nodes" v={data.counts.nodes} d="subject → subskill" />
        <Stat k="Prerequisite edges" v={data.counts.edges} d="validated acyclic" />
      </div>

      <div className="callout" style={{ marginBottom: 20 }}>
        The graph is <strong>versioned trusted infrastructure</strong>: prerequisites are validated
        acyclic, difficulty is an item attribute (never a node), and mapping is blocked until a human
        expert <strong>signs it off</strong> — the program never self-certifies.
      </div>

      <div className="grid grid-3">
        {types.map((t) => (
          <Card key={t}>
            <div className="card-h">
              <h2 style={{ textTransform: "capitalize" }}>{t}</h2>
              <span className="hint">{data.byType[t].length}</span>
            </div>
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
              {data.byType[t].slice(0, 12).map((n) => (
                <div key={n.id} className="small" style={{ display: "flex", gap: 8 }}>
                  {n.code && <span className="chip" style={{ fontSize: 10 }}>{n.code}</span>}
                  <span>{n.label}</span>
                </div>
              ))}
              {data.byType[t].length > 12 && <div className="small muted">+{data.byType[t].length - 12} more</div>}
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
