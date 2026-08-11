import { useEffect, useState } from "react";
import { api, type Session } from "../api";
import { Banner, Button, Card, Chip, TopBar } from "../components";
import type { View } from "../App";

const TOOLS: { view: View; title: string; desc: string }[] = [
  { view: "people", title: "People", desc: "Assign roles and edit names" },
  { view: "structure", title: "School structure", desc: "Campuses and classes" },
  { view: "csv-import", title: "Import users (CSV)", desc: "Bulk-create accounts" },
  { view: "sso", title: "Single sign-on", desc: "Google / Microsoft" },
  { view: "branding", title: "Branding", desc: "Colour, logo, white-label" },
];

/** Post-onboarding landing — a hub for the school's admin tools. */
export function Workspace({ session, displayName, onNavigate, onSignOut }: { session: Session; displayName: string; onNavigate: (v: View) => void; onSignOut: () => void }) {
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
            <div className="card__head"><h2 className="section">Admin tools</h2></div>
            <div className="tiles">
              {TOOLS.map((t) => (
                <button key={t.view} className="tile" style={{ textAlign: "left", cursor: "pointer", background: "var(--pf-card)" }} onClick={() => onNavigate(t.view)}>
                  <div className="tile__label" style={{ fontSize: 14, color: "var(--pf-ink)", fontWeight: 700 }}>{t.title}</div>
                  <div className="tile__label" style={{ marginTop: 4 }}>{t.desc}</div>
                </button>
              ))}
            </div>
          </Card>

          <Card>
            <div className="card__head"><h2 className="section">Teaching &amp; learning</h2><p className="muted">Persona surfaces coming online in later slices.</p></div>
            <ul className="people">
              <li className="person"><span>Content Studio · Assessment Builder (Teacher)</span><span className="spacer" /><Chip state="pending">Next</Chip></li>
              <li className="person"><span>Student workspace · Parent &amp; Principal dashboards</span><span className="spacer" /><Chip state="pending">Next</Chip></li>
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
