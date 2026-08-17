import { useEffect, useState } from "react";
import { NotificationBell } from "../NotificationBell";
import { api, type Session } from "../api";
import { Banner, Button, Card, TopBar } from "../components";
import type { View } from "../App";

const TOOLS: { view: View; title: string; desc: string }[] = [
  { view: "teacher-content", title: "Content Studio", desc: "Upload, approve and map material" },
  { view: "teacher-assessments", title: "Assessments", desc: "Draft, review and publish" },
  { view: "teacher-dashboard", title: "Class dashboard", desc: "Mastery heatmap" },
  { view: "teacher-insights", title: "Class insights", desc: "Focus areas, groups, next actions" },
  { view: "teacher-peer", title: "Peer testing", desc: "Benchmarks, reviews, publish/withhold" },
  { view: "teacher-agent", title: "Teacher Agent", desc: "Grounded drafts — plans, comms, feedback" },
  { view: "teacher-transcripts", title: "Help transcripts", desc: "Ask-for-Help sessions you assigned" },
  { view: "teacher-records", title: "Records & reports", desc: "Growth, behavioural, co-curricular, calendar" },
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
      <TopBar title={displayName} roleTag="Teacher" right={<NotificationBell session={session} />} />
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
            <div className="card__head"><h2 className="section">At a glance</h2><p className="muted">Every tile opens the tool behind it.</p></div>
            <div className="tiles">
              {([
                { num: counts?.library, label: "Library items", view: "teacher-content" },
                { num: counts?.approved, label: "Approved", view: "teacher-content" },
                { num: counts?.drafts, label: "Assessment drafts", view: "teacher-assessments" },
                { num: counts?.published, label: "Published", view: "teacher-assessments" },
              ] as { num: number | undefined; label: string; view: View }[]).map((t) => (
                <button key={t.label} className="tile" style={{ textAlign: "left", cursor: "pointer", background: "var(--pf-card)" }}
                  onClick={() => onNavigate(t.view)} aria-label={`${t.label} — open`}>
                  <div className="tile__num">{t.num ?? "—"}</div>
                  <div className="tile__label">{t.label}</div>
                </button>
              ))}
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

          <div className="btn-row"><span className="spacer" /><Button variant="ghost" onClick={onSignOut}>Sign out</Button></div>
        </div>
      </main>
    </div>
  );
}
