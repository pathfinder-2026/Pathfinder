import { useEffect, useState } from "react";
import { api, type Session } from "../api";
import { Banner, Button, Card, Chip, TopBar } from "../components";
import type { View } from "../App";

const TOOLS: { view: View; title: string; desc: string }[] = [
  { view: "teacher-content", title: "Content Studio", desc: "Upload, approve and map material" },
  { view: "teacher-assessments", title: "Assessments", desc: "Draft, review and publish" },
  { view: "teacher-dashboard", title: "Class dashboard", desc: "Mastery heatmap" },
];

/** The Teacher persona home — hub for the content -> assessment -> dashboard thread. */
export function TeacherHome({ session, displayName, onNavigate, onSignOut }: {
  session: Session; displayName: string; onNavigate: (v: View) => void; onSignOut: () => void;
}) {
  const [counts, setCounts] = useState<{ library: number; approved: number; drafts: number; published: number } | null>(null);
  const [graphReady, setGraphReady] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [content, assessments, skills] = await Promise.all([
          api.listContent(session), api.listAssessments(session), api.skills(session),
        ]);
        setCounts({
          library: content.length,
          approved: content.filter((c) => c.status === "approved" || c.status === "published").length,
          drafts: assessments.filter((a) => a.status === "draft").length,
          published: assessments.filter((a) => a.status === "published").length,
        });
        setGraphReady(skills.signedOff);
      } catch (e) { setError((e as Error).message); }
    })();
  }, [session]);

  return (
    <div className="app">
      <TopBar title={displayName} roleTag="Teacher" />
      <main className="main">
        <div className="container">
          <p className="eyebrow">Teacher workspace</p>
          <h1>Your teaching tools</h1>
          <p className="lede">Build a library of approved material, generate grounded assessments, and track class mastery. Nothing AI-drafted reaches a student until you explicitly publish it.</p>

          {error && <Banner kind="error">{error}</Banner>}
          {graphReady === false && (
            <Banner kind="warn">
              The skill graph hasn't been signed off yet, so content can't be mapped and assessments can't be generated.
              Ask your administrator to review and sign off the curriculum graph.
            </Banner>
          )}

          <Card>
            <div className="card__head"><h2 className="section">At a glance</h2></div>
            <div className="tiles">
              <div className="tile"><div className="tile__num">{counts?.library ?? "—"}</div><div className="tile__label">Library items</div></div>
              <div className="tile"><div className="tile__num">{counts?.approved ?? "—"}</div><div className="tile__label">Approved</div></div>
              <div className="tile"><div className="tile__num">{counts?.drafts ?? "—"}</div><div className="tile__label">Assessment drafts</div></div>
              <div className="tile"><div className="tile__num">{counts?.published ?? "—"}</div><div className="tile__label">Published</div></div>
            </div>
          </Card>

          <Card>
            <div className="card__head"><h2 className="section">Tools</h2></div>
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
            <div className="card__head"><h2 className="section">Coming next</h2></div>
            <ul className="people">
              <li className="person"><span>Focus areas · cohorts · adaptive recommendations</span><span className="spacer" /><Chip state="pending">Next slice</Chip></li>
              <li className="person"><span>Peer testing · Teacher Agent · reports</span><span className="spacer" /><Chip state="pending">Later</Chip></li>
            </ul>
          </Card>

          <div className="btn-row"><span className="spacer" /><Button variant="ghost" onClick={onSignOut}>Sign out</Button></div>
        </div>
      </main>
    </div>
  );
}
