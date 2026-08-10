import { useApi } from "../api";
import { Card, ErrorBox, Loading, Stat } from "../ui";

interface AdminResp {
  school: { name: string };
  campuses: { id: string; name: string }[];
  classes: { id: string; name: string }[];
  accounts: { name: string; role: string; classId: string | null }[];
}

export function Admin() {
  const { data, loading, error } = useApi<AdminResp>("/admin");
  if (loading) return <Loading />;
  if (error || !data) return <ErrorBox message={error ?? "no data"} />;

  return (
    <>
      <div className="grid grid-3" style={{ marginBottom: 20 }}>
        <Stat k="School" v={data.school.name} accent />
        <Stat k="Campuses" v={data.campuses.length} d={data.campuses.map((c) => c.name).join(", ")} />
        <Stat k="Classes" v={data.classes.length} d={data.classes.map((c) => c.name).join(" · ")} />
      </div>

      <Card>
        <div className="card-h"><h2>Accounts & roles</h2><span className="hint">created via M0 onboarding</span></div>
        <table className="tbl" style={{ marginTop: 10 }}>
          <thead><tr><th>Name</th><th>Role</th><th>Class</th></tr></thead>
          <tbody>
            {data.accounts.map((a, i) => (
              <tr key={i}>
                <td style={{ fontWeight: 600 }}>{a.name}</td>
                <td><span className="chip info" style={{ textTransform: "capitalize" }}>{a.role}</span></td>
                <td className="small muted">{a.classId ? data.classes.find((c) => c.id === a.classId)?.name ?? a.classId : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
