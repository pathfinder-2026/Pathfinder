import { useCallback, useEffect, useState } from "react";
import { api, type AdaptivePanel, type CohortGroup, type FocusAreaRow, type NextActionResult, type Session, type SkillsResult } from "../api";
import { Banner, Button, Card, Chip, Field, PageShell } from "../components";
import { SkillPicker } from "../SkillPicker";

/** Actions the adaptive engine hands to a human/other flow rather than an assessment. */
const NOT_ASSESSABLE = new Set(["hint", "escalate"]);

/**
 * TCH-7/8/9 — class intelligence: focus areas (FR-TDB-002), cohort suggestions
 * (FR-COH-001/002) and adaptive recommendations (FR-ADP-001/002). Everything on
 * this screen is a suggestion; work reaches students only through an explicit
 * teacher action, and the platform blocks auto-assign beneath this UI too.
 */
export function TeacherInsights({ session, displayName, onBack, onSignOut, onOpenContent }: {
  session: Session; displayName: string; onBack: () => void; onSignOut: () => void; onOpenContent?: () => void;
}) {
  const [classes, setClasses] = useState<{ id: string; name: string }[] | null>(null);
  const [classId, setClassId] = useState("");
  const [focus, setFocus] = useState<FocusAreaRow[] | null>(null);
  const [groups, setGroups] = useState<CohortGroup[] | null>(null);
  const [membership, setMembership] = useState<Record<string, string[]>>({});
  const [adaptive, setAdaptive] = useState<AdaptivePanel | null>(null);
  const [skills, setSkills] = useState<SkillsResult | null>(null);
  const [lookup, setLookup] = useState({ studentId: "", nodeId: "" });
  const [nextAction, setNextAction] = useState<NextActionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tailoredBusy, setTailoredBusy] = useState(false);

  useEffect(() => {
    Promise.all([api.teacherClasses(session), api.skills(session)]).then(([cs, sk]) => {
      setClasses(cs);
      setSkills(sk);
      if (cs.length > 0) setClassId(cs[0].id);
    }).catch((e) => setError((e as Error).message));
  }, [session]);

  const load = useCallback(async (id: string) => {
    if (!id) return;
    setLoading(true); setError(null); setNextAction(null);
    try {
      const [f, g, a] = await Promise.all([
        api.focusAreas(session, id), api.cohorts(session, id), api.adaptive(session, id),
      ]);
      setFocus(f); setGroups(g); setAdaptive(a);
      // Suggested membership starts complete; the teacher edits before assigning.
      setMembership(Object.fromEntries(g.map((grp) => [grp.id, grp.students.map((s) => s.id)])));
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [session]);

  useEffect(() => { void load(classId); }, [classId, load]);

  const act = async (fn: () => Promise<void>) => {
    setError(null); setNotice(null);
    try { await fn(); await load(classId); } catch (e) { setError((e as Error).message); }
  };

  const toggleMember = (groupId: string, studentId: string) => {
    setMembership((m) => {
      const current = m[groupId] ?? [];
      return { ...m, [groupId]: current.includes(studentId) ? current.filter((s) => s !== studentId) : [...current, studentId] };
    });
  };

  const runLookup = async () => {
    setError(null); setNotice(null); setNextAction(null);
    try { setNextAction(await api.nextAction(session, classId, lookup.studentId, lookup.nodeId)); }
    catch (e) { setError((e as Error).message); }
  };

  /** TCH-19 — draft an assessment tailored to this student's own recommendation. */
  const draftTailored = async () => {
    if (!nextAction) return;
    setError(null); setNotice(null); setTailoredBusy(true);
    try {
      const result = await api.generateTailoredAssessment(session, classId, lookup.studentId, lookup.nodeId);
      if (result.status === "declined") setNotice(result.message);
      else if (result.status === "failed") setError(result.reason);
      else setNotice("Tailored draft created — review the rationale and questions in Assessments before publishing.");
    } catch (e) { setError((e as Error).message); } finally { setTailoredBusy(false); }
  };

  const pct = (f: number) => `${Math.round(f * 100)}%`;

  return (
    <PageShell displayName={displayName} title="Class insights" roleTag="Teacher" backLabel="Back to teacher home"
      onBack={onBack} onSignOut={onSignOut}
      lede="Focus areas, suggested groups and adaptive recommendations — all suggestions. Nothing is assigned to a student unless you explicitly assign it.">
      {error && <Banner kind="error">{error}</Banner>}
      {notice && <Banner kind="brand">{notice}</Banner>}

      <Card>
        <Field label="Class" htmlFor="class-select">
          <select id="class-select" className="select" style={{ maxWidth: 340 }} value={classId} onChange={(e) => setClassId(e.target.value)}>
            {(classes ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        {classes && classes.length === 0 && <div className="muted">No classes yet — your administrator can add them under School structure.</div>}
      </Card>

      {loading && <Card><div className="muted">Loading class insights…</div></Card>}

      {!loading && focus && (
        <Card>
          <div className="card__head">
            <h2 className="section">Focus areas</h2>
            <p className="muted">Skills a meaningful share of the class is below mastery on. Dismissed suggestions stay hidden unless the data worsens.</p>
          </div>
          {focus.length === 0 ? (
            <Banner kind="brand">No class-wide focus areas right now — no skill has enough students below mastery to suggest reteaching.</Banner>
          ) : (
            <ul className="people">
              {focus.map((a) => (
                <li className="person" key={a.nodeId} style={{ flexWrap: "wrap", gap: 10 }}>
                  <span style={{ minWidth: 220 }}><strong>{a.nodeLabel}</strong></span>
                  <span className="person__meta">{a.belowCount} of {a.total} below mastery ({pct(a.belowFraction)})</span>
                  <span className="spacer" />
                  {a.contentGap ? (
                    <>
                      <Chip state="draft">Content gap — nothing mapped to reteach</Chip>
                      {onOpenContent && <button className="linkish" onClick={onOpenContent}>Add material in Content Studio →</button>}
                    </>
                  ) : (
                    a.suggested.map((c) => (
                      <Button key={c.id} onClick={() => act(async () => {
                        const r = await api.assignFocusMaterial(session, classId, a.nodeId, c.id);
                        setNotice(`Assigned "${c.title}" to ${r.students} students.`);
                      })}>Assign “{c.title}”</Button>
                    ))
                  )}
                  <button className="linkish" onClick={() => act(async () => { await api.dismissFocusArea(session, classId, a.nodeId); setNotice("Suggestion dismissed — it will return only if the data worsens."); })}>
                    Dismiss
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {!loading && groups && (
        <Card>
          <div className="card__head">
            <h2 className="section">Suggested groups</h2>
            <p className="muted">Edit membership before assigning — only the students still ticked receive the work. A student can appear in more than one group.</p>
          </div>
          {groups.length === 0 ? (
            <Banner kind="brand">No group suggestions yet — they appear once the class has enough activity data.</Banner>
          ) : groups.map((g) => {
            const selected = membership[g.id] ?? [];
            return (
              <div key={g.id} style={{ border: "1px solid var(--pf-border)", borderRadius: 10, padding: 14, marginBottom: 12 }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <strong>{g.label}</strong>
                  {g.nodeLabel && <span className="person__meta">{g.nodeLabel}</span>}
                  {g.basis === "stale" && <Chip state="pending">Based on older data</Chip>}
                  <span className="spacer" />
                  <span className="person__meta">{selected.length} of {g.students.length} selected</span>
                  <Button variant="primary" disabled={selected.length === 0} onClick={() => act(async () => {
                    const r = await api.assignCohortWork(session, classId, { type: g.type, nodeId: g.nodeId, studentIds: selected });
                    setNotice(`Work assigned to ${r.students} students in "${g.label}".`);
                  })}>Assign work</Button>
                </div>
                {g.staleNote && <Banner kind="warn">{g.staleNote}</Banner>}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                  {g.students.map((s) => (
                    <label key={s.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, border: "1px solid var(--pf-border)", borderRadius: 999, padding: "4px 10px" }}>
                      <input type="checkbox" checked={selected.includes(s.id)} onChange={() => toggleMember(g.id, s.id)} aria-label={`Include ${s.label}`} />
                      {s.label}
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </Card>
      )}

      {!loading && adaptive && (
        <Card>
          <div className="card__head">
            <h2 className="section">Adaptive recommendations</h2>
            <p className="muted">Recommendations weigh independent and assisted work — never just the latest score. Persistent misconceptions are escalated to you rather than looped through remediation.</p>
          </div>

          {adaptive.escalations.length > 0 && (
            <>
              <h3 style={{ fontSize: 14, margin: "0 0 8px" }}>Needs a teaching decision</h3>
              <ul className="people">
                {adaptive.escalations.map((e) => (
                  <li className="person" key={`${e.studentId}-${e.nodeId}`}>
                    <span><strong>{e.studentLabel}</strong> · {e.nodeLabel}</span>
                    <span className="person__meta">“{e.misconception}” across {e.occurrences} attempts</span>
                    <span className="spacer" />
                    <Chip state="draft">Escalated to you</Chip>
                  </li>
                ))}
              </ul>
            </>
          )}

          {adaptive.reminders.length > 0 && (
            <>
              <h3 style={{ fontSize: 14, margin: "16px 0 8px" }}>Spaced revision due</h3>
              <ul className="people">
                {adaptive.reminders.map((r) => (
                  <li className="person" key={`${r.studentId}-${r.nodeId}`}>
                    <span>{r.studentLabel} · {r.nodeLabel}</span>
                    <span className="spacer" />
                    {r.deferred ? <Chip state="pending">Deferred — assessment in progress</Chip> : <Chip state="approved">Ready</Chip>}
                  </li>
                ))}
              </ul>
            </>
          )}

          {adaptive.escalations.length === 0 && adaptive.reminders.length === 0 && (
            <Banner kind="brand">Nothing needs your attention — no escalations and no revision due.</Banner>
          )}

          <h3 style={{ fontSize: 14, margin: "18px 0 8px" }}>What next for a student?</h3>
          <div className="row">
            <Field label="Student" htmlFor="na-student">
              <select id="na-student" className="select" value={lookup.studentId} onChange={(e) => setLookup({ ...lookup, studentId: e.target.value })}>
                <option value="">Choose…</option>
                {adaptive.students.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </Field>
            {/* No capacity filter here: asking "what next?" for a skill with no
                approved material is a legitimate question — the answer may be
                what tells the teacher to go add material. */}
            <SkillPicker
              skills={skills} value={lookup.nodeId} idPrefix="na"
              onChange={(nodeId) => setLookup((l) => ({ ...l, nodeId }))}
            />
          </div>
          <Button onClick={runLookup} disabled={!lookup.studentId || !lookup.nodeId}>Recommend next action</Button>
          {nextAction && (
            <div style={{ marginTop: 12 }}>
              <Banner kind={nextAction.escalated ? "warn" : "brand"}>
                <strong style={{ textTransform: "capitalize" }}>{nextAction.action}</strong> — {nextAction.reason}
              </Banner>
              {NOT_ASSESSABLE.has(nextAction.action) ? (
                <p className="muted" style={{ marginTop: 8 }}>
                  {nextAction.action === "hint" ? "Not an assessment — draft a hint via the Teacher Agent instead." : "Escalated — this needs a teaching decision, not another assessment."}
                </p>
              ) : (
                <div style={{ marginTop: 8 }}>
                  <Button variant="primary" onClick={draftTailored} disabled={tailoredBusy}>
                    {tailoredBusy ? "Drafting…" : "Draft assessment tailored to this"}
                  </Button>
                </div>
              )}
            </div>
          )}
        </Card>
      )}
    </PageShell>
  );
}
