import { useEffect, useState } from "react";
import { api, type Session } from "../api";
import { Banner, Button, Card, Chip, TopBar } from "../components";

/** Post-onboarding landing — confirms the school is live with a summary. */
export function Workspace({ session, displayName, onSignOut }: { session: Session; displayName: string; onSignOut: () => void }) {
  const [summary, setSummary] = useState<{ schoolName: string; counts: { teachers: number; students: number; parents: number; classes: number } } | null>(null);

  useEffect(() => { void api.summary(session).then(setSummary); }, [session]);

  return (
    <div className="app">
      <TopBar title={displayName} roleTag="Administrator · Workspace" />
      <main className="main">
        <div className="container">
          <p className="eyebrow">You're live</p>
          <h1>{summary?.schoolName ?? "Your school"} <Chip state="approved">Active</Chip></h1>
          <p className="lede">Onboarding is complete. This is your administrator workspace — the persona surfaces (Teacher, Student, Parent, Principal) plug in here as they come online.</p>

          <Banner kind="brand">Setup complete — your school is ready for teachers to start building content.</Banner>

          <Card>
            <div className="card__head"><h2 className="section">At a glance</h2></div>
            <div className="tiles">
              <div className="tile"><div className="tile__num">{summary?.counts.classes ?? "—"}</div><div className="tile__label">Classes</div></div>
              <div className="tile"><div className="tile__num">{summary?.counts.teachers ?? "—"}</div><div className="tile__label">Teachers</div></div>
              <div className="tile"><div className="tile__num">{summary?.counts.students ?? "—"}</div><div className="tile__label">Students</div></div>
              <div className="tile"><div className="tile__num">{summary?.counts.parents ?? "—"}</div><div className="tile__label">Parents</div></div>
            </div>
          </Card>

          <Card>
            <div className="card__head"><h2 className="section">Next steps</h2><p className="muted">Coming online in later slices of the production UI.</p></div>
            <ul className="people">
              <li className="person"><span>Content Studio — upload & approve teaching material</span><span className="spacer" /><Chip state="pending">Soon</Chip></li>
              <li className="person"><span>Assessment Builder — generate from approved content</span><span className="spacer" /><Chip state="pending">Soon</Chip></li>
              <li className="person"><span>Teacher & Principal dashboards</span><span className="spacer" /><Chip state="pending">Soon</Chip></li>
            </ul>
          </Card>

          <div className="btn-row">
            <span className="spacer" />
            <Button variant="ghost" onClick={onSignOut}>Sign out</Button>
          </div>
        </div>
      </main>
    </div>
  );
}
