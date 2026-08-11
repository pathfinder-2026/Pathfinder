import { useCallback, useEffect, useState } from "react";
import { api, type Session } from "../api";
import { Banner, Button, Card, Field, PageShell } from "../components";

/** FR-ADM-001 — manage campuses and classes after setup. */
export function Structure({ session, displayName, onBack, onSignOut }: {
  session: Session; displayName: string; onBack: () => void; onSignOut: () => void;
}) {
  const [campuses, setCampuses] = useState<{ id: string; name: string }[]>([]);
  const [classes, setClasses] = useState<{ id: string; name: string; yearGroup: string | null }[]>([]);
  const [campusName, setCampusName] = useState("");
  const [className, setClassName] = useState("");
  const [yearGroup, setYearGroup] = useState("8");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [c, k] = await Promise.all([api.campuses(session), api.listClasses(session)]);
    setCampuses(c); setClasses(k);
  }, [session]);
  useEffect(() => { void refresh(); }, [refresh]);

  const addCampus = async () => {
    setError(null);
    if (!campusName.trim()) return;
    try { await api.addCampus(session, campusName.trim()); setCampusName(""); await refresh(); }
    catch (e) { setError((e as Error).message); }
  };
  const addClass = async () => {
    setError(null);
    if (!className.trim()) return;
    try { await api.createClass(session, className.trim(), yearGroup.trim()); setClassName(""); await refresh(); }
    catch (e) { setError((e as Error).message); }
  };

  return (
    <PageShell displayName={displayName} title="School structure" onBack={onBack} onSignOut={onSignOut}
      lede="Manage campuses and classes. New campuses inherit the school's settings.">
      {error && <Banner kind="error">{error}</Banner>}
      <Card>
        <div className="card__head"><h2 className="section">Campuses</h2></div>
        <ul className="people">
          {campuses.map((c) => <li className="person" key={c.id}><span className="person__avatar">{c.name.slice(0, 2).toUpperCase()}</span><span>{c.name}</span></li>)}
        </ul>
        <div className="row" style={{ marginTop: 14 }}>
          <Field label="New campus name" htmlFor="cn"><input id="cn" className="input" value={campusName} onChange={(e) => setCampusName(e.target.value)} placeholder="North Campus" /></Field>
          <div style={{ display: "flex", alignItems: "flex-end" }}><Button onClick={addCampus}>Add campus</Button></div>
        </div>
      </Card>
      <Card>
        <div className="card__head"><h2 className="section">Classes</h2></div>
        <ul className="people">
          {classes.map((k) => <li className="person" key={k.id}><span className="person__avatar">{k.name.slice(0, 2).toUpperCase()}</span><span>{k.name}</span><span className="person__meta">Year {k.yearGroup ?? "—"}</span></li>)}
        </ul>
        <div className="row" style={{ marginTop: 14 }}>
          <Field label="New class name" htmlFor="kn"><input id="kn" className="input" value={className} onChange={(e) => setClassName(e.target.value)} placeholder="8B Mathematics" /></Field>
          <Field label="Year group" htmlFor="yg"><input id="yg" className="input" value={yearGroup} onChange={(e) => setYearGroup(e.target.value)} /></Field>
        </div>
        <Button onClick={addClass}>Add class</Button>
      </Card>
    </PageShell>
  );
}
