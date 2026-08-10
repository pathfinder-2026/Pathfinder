import { useApi } from "../api";
import { Card, ErrorBox, Loading, StatusBadge } from "../ui";

interface ContentResp {
  items: { id: string; title: string; status: string; mappedSkills: string[] }[];
}

export function Content() {
  const { data, loading, error } = useApi<ContentResp>("/content");
  if (loading) return <Loading />;
  if (error || !data) return <ErrorBox message={error ?? "no data"} />;

  const approved = data.items.filter((i) => i.status === "approved" || i.status === "published").length;

  return (
    <>
      <div className="pill-note" style={{ marginBottom: 20 }}>
        Only <strong>approved</strong> content reaches students or grounds AI generation. Draft/pending
        items sit behind the governance gate until a teacher approves them — {approved} of {data.items.length} here are approved.
      </div>
      <Card>
        <div className="card-h"><h2>Content items</h2><span className="hint">the approval gate + skill mappings</span></div>
        <table className="tbl" style={{ marginTop: 10 }}>
          <thead>
            <tr><th>Title</th><th>Governance</th><th>Mapped skills</th></tr>
          </thead>
          <tbody>
            {data.items.map((it) => (
              <tr key={it.id}>
                <td style={{ fontWeight: 600 }}>{it.title}</td>
                <td><StatusBadge status={it.status} /></td>
                <td>
                  {it.mappedSkills.length === 0
                    ? <span className="muted small">—</span>
                    : it.mappedSkills.map((s) => <span key={s} className="chip" style={{ marginRight: 6 }}>{s}</span>)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
