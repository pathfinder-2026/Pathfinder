import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type Session } from "../api";
import { Banner, Button, Card, Chip, Field, PageShell } from "../components";

const CATEGORIES = ["collaboration", "communication", "resilience", "participation"] as const;
const DOMAINS = ["sport", "arts", "music"] as const;
const EVENT_TYPES = ["class", "assessment", "homework", "co_curricular", "parent_meeting"] as const;

/**
 * TCH-15/16/18 — growth report, behavioural/social + co-curricular records, and
 * the teacher calendar. Behavioural notes are teacher-authored with NO score
 * anywhere (AI scoring is blocked in the domain), collection is consent-gated,
 * and co-curricular stays a separate structure from academic mastery.
 */
export function TeacherRecords({ session, displayName, onBack, onSignOut }: {
  session: Session; displayName: string; onBack: () => void; onSignOut: () => void;
}) {
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([]);
  const [classId, setClassId] = useState("");
  const [students, setStudents] = useState<{ id: string; label: string }[]>([]);
  const [studentId, setStudentId] = useState("");
  const [growth, setGrowth] = useState<Awaited<ReturnType<typeof api.growthReport>> | null>(null);
  const [records, setRecords] = useState<Awaited<ReturnType<typeof api.studentRecords>> | null>(null);
  const [events, setEvents] = useState<Awaited<ReturnType<typeof api.teacherCalendar>> | null>(null);
  const [noteForm, setNoteForm] = useState({ category: "collaboration", note: "" });
  const [ccForm, setCcForm] = useState({ domain: "sport", skill: "", level: "" });
  const [evForm, setEvForm] = useState({ title: "", type: "lesson", eventDate: "", yearGroup: "" });
  const [consentBlocked, setConsentBlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    api.teacherClasses(session).then((cs) => { setClasses(cs); if (cs.length > 0) setClassId(cs[0].id); }).catch((e) => setError((e as Error).message));
    api.teacherCalendar(session).then(setEvents).catch((e) => setError((e as Error).message));
  }, [session]);

  useEffect(() => {
    if (!classId) return;
    api.growthReport(session, classId).then(setGrowth).catch((e) => setError((e as Error).message));
    api.classStudents(session, classId).then((s) => { setStudents(s); setStudentId(s[0]?.id ?? ""); }).catch((e) => setError((e as Error).message));
  }, [session, classId]);

  const loadRecords = useCallback(() => {
    if (!studentId) { setRecords(null); return; }
    api.studentRecords(session, studentId).then(setRecords).catch((e) => setError((e as Error).message));
  }, [session, studentId]);
  useEffect(() => { loadRecords(); }, [loadRecords]);

  const addNote = async () => {
    setError(null); setNotice(null); setConsentBlocked(false);
    try {
      await api.recordBehavioural(session, studentId, noteForm.category, noteForm.note);
      setNoteForm({ ...noteForm, note: "" });
      setNotice("Observation recorded — your note, no score, visible per the school's policy.");
      loadRecords();
    } catch (e) {
      if (e instanceof ApiError && e.code === "CONSENT_NOT_CONFIGURED") setConsentBlocked(true);
      else setError((e as Error).message);
    }
  };

  const addCc = async () => {
    setError(null); setNotice(null);
    try {
      await api.recordCoCurricular(session, studentId, ccForm);
      setCcForm({ domain: ccForm.domain, skill: "", level: "" });
      setNotice("Co-curricular capability recorded (kept separate from academic mastery).");
      loadRecords();
    } catch (e) { setError((e as Error).message); }
  };

  const addEvent = async () => {
    setError(null); setNotice(null);
    try {
      await api.createCalendarEvent(session, { title: evForm.title, type: evForm.type, eventDate: evForm.eventDate, yearGroup: evForm.yearGroup || null });
      setEvForm({ title: "", type: "lesson", eventDate: "", yearGroup: "" });
      setEvents(await api.teacherCalendar(session));
    } catch (e) { setError((e as Error).message); }
  };

  const reschedule = async (eventId: string) => {
    const newDate = window.prompt("New date (YYYY-MM-DD):");
    if (!newDate) return;
    setError(null);
    try {
      await api.rescheduleCalendarEvent(session, eventId, newDate);
      setNotice("Rescheduled — students see it flagged as changed.");
      setEvents(await api.teacherCalendar(session));
    } catch (e) { setError((e as Error).message); }
  };

  const pct = (n: number) => `${Math.round(n * 100)}%`;

  return (
    <PageShell displayName={displayName} title="Records & reports" roleTag="Teacher" backLabel="Back to teacher home"
      onBack={onBack} onSignOut={onSignOut}
      lede="Term growth, behavioural/social observations (your words, never a score), co-curricular capabilities, and your calendar.">
      {error && <Banner kind="error">{error}</Banner>}
      {notice && <Banner kind="brand">{notice}</Banner>}

      <Card>
        <div className="card__head"><h2 className="section">Growth report</h2></div>
        <Field label="Class" htmlFor="rec-class">
          <select id="rec-class" className="select" style={{ maxWidth: 340 }} value={classId} onChange={(e) => setClassId(e.target.value)}>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        {growth && growth.limited && <Banner kind="warn">{growth.note}</Banner>}
        {growth && growth.growth.length === 0 ? (
          <Banner kind="brand">No mastery data for this class yet — the growth report appears once students have worked on assigned material.</Banner>
        ) : growth && (
          <div style={{ overflowX: "auto" }}>
            <table className="heatmap" aria-label={`Growth report for ${growth.className}`}>
              <thead><tr><th scope="col">Skill</th><th scope="col">Baseline</th><th scope="col">Current</th><th scope="col">Change</th></tr></thead>
              <tbody>
                {growth.growth.map((g) => (
                  <tr key={g.nodeId}>
                    <th scope="row">{g.nodeLabel}</th>
                    <td>{pct(g.baseline)}</td>
                    <td>{pct(g.current)}</td>
                    <td>{g.change >= 0 ? "+" : ""}{pct(g.change)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <div className="card__head">
          <h2 className="section">Student records</h2>
          <p className="muted">Behavioural notes use the four fixed categories, in your words — there is no score and AI never infers one. Co-curricular is its own record, separate from academic mastery.</p>
        </div>
        <Field label="Student" htmlFor="rec-student">
          <select id="rec-student" className="select" style={{ maxWidth: 340 }} value={studentId} onChange={(e) => setStudentId(e.target.value)}>
            {students.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </Field>
        {consentBlocked && (
          <Banner kind="warn">Behavioural collection is disabled until your school configures its parental-consent mechanism — ask your administrator.</Banner>
        )}
        <div className="row">
          <Field label="Behavioural category" htmlFor="rec-cat">
            <select id="rec-cat" className="select" value={noteForm.category} onChange={(e) => setNoteForm({ ...noteForm, category: e.target.value })}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Observation (your words)" htmlFor="rec-note">
            <input id="rec-note" className="input" value={noteForm.note} onChange={(e) => setNoteForm({ ...noteForm, note: e.target.value })} />
          </Field>
        </div>
        <Button onClick={addNote} disabled={!studentId || !noteForm.note.trim()}>Record observation</Button>

        <div className="row" style={{ marginTop: 16 }}>
          <Field label="Co-curricular domain" htmlFor="rec-dom">
            <select id="rec-dom" className="select" value={ccForm.domain} onChange={(e) => setCcForm({ ...ccForm, domain: e.target.value })}>
              {DOMAINS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </Field>
          <Field label="Skill & level" htmlFor="rec-skill">
            <span style={{ display: "flex", gap: 8 }}>
              <input id="rec-skill" className="input" placeholder="e.g. violin - grade 3" value={ccForm.skill} onChange={(e) => setCcForm({ ...ccForm, skill: e.target.value })} />
              <input className="input" placeholder="level" style={{ maxWidth: 120 }} value={ccForm.level} onChange={(e) => setCcForm({ ...ccForm, level: e.target.value })} aria-label="Level" />
            </span>
          </Field>
        </div>
        <Button onClick={addCc} disabled={!studentId || !ccForm.skill.trim() || !ccForm.level.trim()}>Record capability</Button>

        {records && (records.behavioural.notes.length > 0 || records.coCurricular.length > 0) && (
          <div style={{ marginTop: 16 }}>
            {records.behavioural.notes.length > 0 && (
              <>
                <h3 style={{ fontSize: 14, margin: "0 0 8px" }}>Behavioural observations (yours)</h3>
                <ul className="people">
                  {records.behavioural.notes.map((n) => (
                    <li className="person" key={n.id}><Chip state="draft">{n.category}</Chip><span>{n.note}</span></li>
                  ))}
                </ul>
              </>
            )}
            {records.coCurricular.length > 0 && (
              <>
                <h3 style={{ fontSize: 14, margin: "14px 0 8px" }}>Co-curricular</h3>
                <ul className="people">
                  {records.coCurricular.map((c) => (
                    <li className="person" key={c.id}><Chip state="approved">{c.domain}</Chip><span>{c.skill}</span><span className="person__meta">{c.level}</span></li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </Card>

      <Card>
        <div className="card__head"><h2 className="section">Calendar</h2><p className="muted">Rescheduling an event flags it as changed on every student's calendar. Year-group-restricted events are invisible to other year groups.</p></div>
        <div className="row">
          <Field label="Title" htmlFor="ev-title"><input id="ev-title" className="input" value={evForm.title} onChange={(e) => setEvForm({ ...evForm, title: e.target.value })} /></Field>
          <Field label="Type" htmlFor="ev-type">
            <select id="ev-type" className="select" value={evForm.type} onChange={(e) => setEvForm({ ...evForm, type: e.target.value })}>
              {EVENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
        </div>
        <div className="row">
          <Field label="Date" htmlFor="ev-date"><input id="ev-date" className="input" type="date" value={evForm.eventDate} onChange={(e) => setEvForm({ ...evForm, eventDate: e.target.value })} /></Field>
          <Field label="Restrict to year group (optional)" htmlFor="ev-yg"><input id="ev-yg" className="input" value={evForm.yearGroup} onChange={(e) => setEvForm({ ...evForm, yearGroup: e.target.value })} placeholder="e.g. 8" /></Field>
        </div>
        <Button onClick={addEvent} disabled={!evForm.title.trim() || !evForm.eventDate}>Add event</Button>
        {events && events.length > 0 && (
          <ul className="people" style={{ marginTop: 14 }}>
            {events.map((e) => (
              <li className="person" key={e.id}>
                <span><strong>{e.title}</strong></span>
                <span className="person__meta">{e.eventDate} · {e.type}{e.yearGroup ? ` · Year ${e.yearGroup} only` : ""}</span>
                {e.changed && <Chip state="pending">Rescheduled</Chip>}
                <span className="spacer" />
                <button className="linkish" onClick={() => reschedule(e.id)}>Reschedule</button>
              </li>
            ))}
          </ul>
        )}
        {events && events.length === 0 && <p className="muted" style={{ marginTop: 12 }}>No events yet.</p>}
      </Card>
    </PageShell>
  );
}
