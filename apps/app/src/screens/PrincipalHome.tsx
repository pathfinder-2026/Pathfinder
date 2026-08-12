import { useEffect, useState } from "react";
import { api, type PrincipalTeacherReport, type Session } from "../api";
import { Banner, Button, Card, Chip, TopBar } from "../components";

/**
 * PRB-1..5 — the Principal's school-level view. Ask-for-Help transcripts are
 * unreachable from every surface here by construction; outlier classes are
 * highlighted rather than smoothed; teacher-to-teacher comparison renders only
 * when school policy enables it; cross-campus comparison is not offered.
 */
export function PrincipalHome({ session, displayName, onSignOut }: {
  session: Session; displayName: string; onSignOut: () => void;
}) {
  const [report, setReport] = useState<PrincipalTeacherReport | null>(null);
  const [mastery, setMastery] = useState<Awaited<ReturnType<typeof api.principalMastery>> | null>(null);
  const [alerts, setAlerts] = useState<Awaited<ReturnType<typeof api.principalAlerts>> | null>(null);
  const [drillClass, setDrillClass] = useState<Awaited<ReturnType<typeof api.principalDrillClass>> | null>(null);
  const [drillStudent, setDrillStudent] = useState<Awaited<ReturnType<typeof api.principalDrillStudent>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.principalTeacherReport(session).then(setReport).catch((e) => setError((e as Error).message));
    api.principalMastery(session).then(setMastery).catch(() => setMastery(null));
    api.principalAlerts(session).then(setAlerts).catch(() => setAlerts(null));
  }, [session]);

  const pct = (n: number) => `${Math.round(n * 100)}%`;

  const openClass = async (classId: string) => {
    setError(null); setDrillStudent(null);
    try { setDrillClass(await api.principalDrillClass(session, classId)); }
    catch (e) { setError((e as Error).message); }
  };
  const openStudent = async (studentId: string) => {
    setError(null);
    try { setDrillStudent(await api.principalDrillStudent(session, studentId)); }
    catch (e) { setError((e as Error).message); }
  };

  return (
    <div className="app">
      <TopBar title={displayName} roleTag="Principal" />
      <main className="main">
        <div className="container">
          <p className="eyebrow">School overview</p>
          <h1>How the school is going</h1>
          <p className="lede">Teaching activity and mastery at school level. Ask-for-Help conversations are never visible here — they belong to the assigning teacher.</p>
          {error && <Banner kind="error">{error}</Banner>}

          {alerts && alerts.length > 0 && (
            <Card>
              <div className="card__head"><h2 className="section">Needs attention</h2></div>
              <ul className="people">
                {alerts.map((a, i) => (
                  <li className="person" key={i}><Chip state="draft">{a.kind.replace(/_/g, " ")}</Chip><span>{a.message}</span></li>
                ))}
              </ul>
            </Card>
          )}

          {report && (
            <Card>
              <div className="card__head">
                <h2 className="section">Teachers</h2>
                <p className="muted">{report.schoolWide.teacherCount} teachers · avg engagement {pct(report.schoolWide.avgEngagement)} · AI-draft approval {pct(report.schoolWide.avgAiApprovalRate)}. New teachers are shown in a shorter window, not compared unfairly.</p>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table className="heatmap" aria-label="Per-teacher metrics">
                  <thead><tr><th scope="col">Teacher</th><th scope="col">Coverage</th><th scope="col">Published</th><th scope="col">AI approval</th><th scope="col">Edit rate</th><th scope="col">Engagement</th><th scope="col"></th></tr></thead>
                  <tbody>
                    {report.teachers.map((t) => (
                      <tr key={t.teacherId}>
                        <th scope="row">{t.name ?? "Teacher"}</th>
                        <td>{t.coverage}</td>
                        <td>{t.assessmentsPublished}/{t.assessmentsAuthored}</td>
                        <td>{pct(t.aiApprovalRate)}</td>
                        <td>{pct(t.editRate)}</td>
                        <td>{pct(t.engagement)}</td>
                        <td>
                          {t.newTeacher && <Chip state="pending">New — {t.windowDays}-day window</Chip>}
                          {t.lowEngagementOutlier && <Chip state="draft">Low activity</Chip>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {report.comparison ? (
                <div style={{ marginTop: 14 }}>
                  <h3 style={{ fontSize: 14, margin: "0 0 8px" }}>Engagement ranking <Chip state="pending">Policy-enabled</Chip></h3>
                  <ul className="people">
                    {report.comparison.ranking.map((r, i) => (
                      <li className="person" key={r.teacherId}><span className="person__meta">#{i + 1}</span><span>{r.name ?? "Teacher"}</span><span className="spacer" /><span className="person__meta">{pct(r.engagement)}</span></li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="muted" style={{ marginTop: 12 }}>Teacher-to-teacher comparison is off (the school's default). Your administrator can enable it in policy.</p>
              )}
            </Card>
          )}

          {mastery && (
            <Card>
              <div className="card__head">
                <h2 className="section">Mastery by class</h2>
                <p className="muted">School average {pct(mastery.schoolWide.avgScore)} · {mastery.schoolWide.atRiskCount} students at risk. Outlier classes are highlighted, never smoothed into the average. No cross-campus comparison is offered.</p>
              </div>
              {mastery.classes.length === 0 ? <Banner kind="brand">No class mastery data yet.</Banner> : (
                <ul className="people">
                  {mastery.classes.map((c) => (
                    <li className="person" key={c.classId}>
                      <button className="linkish" onClick={() => openClass(c.classId)}><strong>{c.name}</strong></button>
                      <span className="person__meta">{c.studentCount} students · avg {pct(c.avgScore)} · {c.atRiskCount} at risk</span>
                      <span className="spacer" />
                      {c.outlier && <Chip state="draft">Outlier — below school average</Chip>}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          {drillClass && (
            <Card>
              <div className="card__head"><h2 className="section">{drillClass.name}</h2></div>
              <ul className="people">
                {drillClass.students.map((s) => (
                  <li className="person" key={s.studentId}>
                    <button className="linkish" onClick={() => openStudent(s.studentId)}>{s.name ?? "Student"}</button>
                    <span className="person__meta">avg {pct(s.avgScore)}</span>
                    <span className="spacer" />
                    {s.atRisk && <Chip state="draft">At risk</Chip>}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {drillStudent && (
            <Card>
              <div className="card__head">
                <h2 className="section">{drillStudent.name ?? "Student"}</h2>
                <p className="muted">avg {pct(drillStudent.avgScore)} · {drillStudent.tasksCompleted} tasks completed. Ask-for-Help conversations are not part of this view at any level.</p>
              </div>
              <ul className="people">
                {drillStudent.skills.map((sk) => (
                  <li className="person" key={sk.nodeId}><span>{sk.nodeId}</span><span className="spacer" /><span className="person__meta">{sk.level} · {pct(sk.score)}</span></li>
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
