import { useEffect, useState } from "react";
import { api, type Session } from "../api";
import { Banner, Button, Card, Chip, Field, TopBar } from "../components";

/**
 * PAR-1..5 — the parent surface. Verification-before-data is absolute: only
 * Admin-verified children appear, each kept separate. Everything shown is
 * plain-language and observational — never diagnostic, never raw analytics.
 */
export function ParentHome({ session, displayName, onSignOut }: {
  session: Session; displayName: string; onSignOut: () => void;
}) {
  const [children, setChildren] = useState<Awaited<ReturnType<typeof api.parentChildren>> | null>(null);
  const [studentId, setStudentId] = useState("");
  const [dash, setDash] = useState<Awaited<ReturnType<typeof api.parentDashboard>> | null>(null);
  const [cal, setCal] = useState<Awaited<ReturnType<typeof api.parentCalendar>> | null>(null);
  const [report, setReport] = useState<Awaited<ReturnType<typeof api.parentReport>> | null>(null);
  const [digests, setDigests] = useState<Awaited<ReturnType<typeof api.parentDigests>> | null>(null);
  const [showReport, setShowReport] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.parentChildren(session).then((c) => { setChildren(c); if (c.length > 0) setStudentId(c[0].studentId); }).catch((e) => setError((e as Error).message));
    api.parentDigests(session).then(setDigests).catch(() => setDigests(null));
  }, [session]);

  useEffect(() => {
    if (!studentId) return;
    setDash(null); setCal(null); setReport(null); setShowReport(false); setError(null);
    api.parentDashboard(session, studentId).then(setDash).catch((e) => setError((e as Error).message));
    api.parentCalendar(session, studentId).then(setCal).catch(() => setCal(null));
  }, [session, studentId]);

  const openReport = async () => {
    setError(null);
    try { setReport(await api.parentReport(session, studentId)); setShowReport(true); }
    catch (e) { setError((e as Error).message); }
  };

  return (
    <div className="app">
      <TopBar title={displayName} roleTag="Parent" />
      <main className="main">
        <div className="container">
          <p className="eyebrow">Your family</p>
          <h1>How things are going</h1>
          <p className="lede">A plain-language picture of your child's learning. For anything deeper, the teacher is always the best next step.</p>
          {error && <Banner kind="error">{error}</Banner>}

          {children && children.length === 0 && (
            <Card>
              <Banner kind="brand">No verified children yet. Your school links and verifies your relationship — once that's done, your child appears here.</Banner>
            </Card>
          )}

          {children && children.length > 0 && (
            <>
              <Card>
                <Field label="Child" htmlFor="par-child">
                  <select id="par-child" className="select" style={{ maxWidth: 340 }} value={studentId} onChange={(e) => setStudentId(e.target.value)}>
                    {children.map((c) => <option key={c.studentId} value={c.studentId}>{c.childName ?? "Your child"}{c.yearGroup ? ` — Year ${c.yearGroup}` : ""}</option>)}
                  </select>
                </Field>
                {children.length > 1 && <p className="muted">Each child is shown separately — their information is never combined.</p>}
              </Card>

              {dash && (
                <Card>
                  <div className="card__head"><h2 className="section">{dash.childName ?? "Your child"} · {dash.period}</h2></div>
                  <Banner kind="brand">{dash.summaryText}</Banner>
                  {dash.hasRecentActivity && (
                    <>
                      {dash.strengths.length > 0 && (
                        <>
                          <h3 style={{ fontSize: 14, margin: "12px 0 8px" }}>Going well</h3>
                          <div className="legend">{dash.strengths.map((t) => <Chip key={t} state="approved">{t}</Chip>)}</div>
                        </>
                      )}
                      {dash.focusAreas.length > 0 && (
                        <>
                          <h3 style={{ fontSize: 14, margin: "12px 0 8px" }}>Working on</h3>
                          <div className="legend">{dash.focusAreas.map((t) => <Chip key={t} state="pending">{t}</Chip>)}</div>
                        </>
                      )}
                      {dash.recentActivity.length > 0 && (
                        <p className="muted" style={{ marginTop: 12 }}>Recently: {dash.recentActivity.join(" · ")}</p>
                      )}
                    </>
                  )}
                  <div className="btn-row"><Button onClick={openReport}>Term report</Button></div>
                </Card>
              )}

              {showReport && report && (
                <Card>
                  <div className="card__head"><h2 className="section">Term report — {report.childName ?? "your child"}</h2></div>
                  {report.strengths.length > 0 && <><h3 style={{ fontSize: 14, margin: "0 0 8px" }}>Strengths</h3><div className="legend">{report.strengths.map((t) => <Chip key={t} state="approved">{t}</Chip>)}</div></>}
                  {report.focusAreas.length > 0 && <><h3 style={{ fontSize: 14, margin: "12px 0 8px" }}>Focus areas</h3><div className="legend">{report.focusAreas.map((t) => <Chip key={t} state="pending">{t}</Chip>)}</div></>}
                  {report.teacherComments.length > 0 && (
                    <><h3 style={{ fontSize: 14, margin: "12px 0 8px" }}>Teacher comments</h3>
                    <ul className="people">{report.teacherComments.map((c, i) => <li className="person" key={i}><span>{c}</span></li>)}</ul></>
                  )}
                  {report.coCurricular.length > 0 && (
                    <><h3 style={{ fontSize: 14, margin: "12px 0 8px" }}>Beyond the classroom</h3>
                    <ul className="people">{report.coCurricular.map((c, i) => <li className="person" key={i}><Chip state="approved">{c.domain}</Chip><span>{c.skill}</span><span className="person__meta">{c.level}</span></li>)}</ul></>
                  )}
                  {report.strengths.length === 0 && report.focusAreas.length === 0 && report.teacherComments.length === 0 && report.coCurricular.length === 0 && (
                    <p className="muted">Nothing to report yet this term.</p>
                  )}
                </Card>
              )}

              {cal && cal.length > 0 && (
                <Card>
                  <div className="card__head"><h2 className="section">Coming up</h2></div>
                  <ul className="people">
                    {cal.map((e) => (
                      <li className="person" key={`${e.id}-${e.date}`}>
                        <span><strong>{e.title}</strong></span>
                        <span className="person__meta">{e.date.slice(0, 10)}</span>
                        <span className="spacer" />
                        {e.changed && <Chip state="pending">Date changed</Chip>}
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </>
          )}

          {digests && digests.length > 0 && (
            <Card>
              <div className="card__head"><h2 className="section">Weekly updates</h2><p className="muted">One consolidated update a week — only when there's something new.</p></div>
              <ul className="people">
                {digests.map((d, i) => (
                  <li className="person" key={i}><span><strong>{d.subject}</strong></span><span className="person__meta">{d.body}</span></li>
                ))}
              </ul>
            </Card>
          )}

          <div className="btn-row"><span className="spacer" /><Button variant="ghost" onClick={onSignOut}>Sign out</Button></div>
        </div>
      </main>
    </div>
  );
}
