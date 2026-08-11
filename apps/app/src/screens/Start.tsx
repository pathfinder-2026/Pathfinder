import { useState, type FormEvent } from "react";
import { api, type Session } from "../api";
import { Banner, Button, Card, Field, TopBar } from "../components";

/**
 * Entry screen — create the school + founding Admin and receive a session. This
 * is onboarding step 1 ("create"); on success the app moves to the trail.
 */
export function Start({ onStarted }: { onStarted: (s: Session) => void }) {
  const [form, setForm] = useState({
    schoolName: "", campusName: "Main Campus", yearName: "2026",
    termName: "Term 1", termStart: "2026-01-28", termEnd: "2026-04-10",
    firstName: "", lastName: "", email: "", password: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await api.startOnboarding({
        school: {
          name: form.schoolName,
          campusName: form.campusName,
          academicYear: { name: form.yearName, terms: [{ name: form.termName, startDate: form.termStart, endDate: form.termEnd }] },
        },
        admin: { email: form.email, firstName: form.firstName, lastName: form.lastName, password: form.password },
      });
      onStarted({ token: res.token, schoolId: res.schoolId, campusId: res.campusId });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app">
      <TopBar title="Pathfinder" roleTag="School setup" />
      <main className="main">
        <div className="container center">
          <div className="narrow">
            <p className="eyebrow">Get started</p>
            <h1>Set up your school</h1>
            <p className="lede">Create your school and administrator account. You'll be guided through the rest of setup step by step.</p>
            <Card>
              <form onSubmit={submit}>
                {error && <Banner kind="error">{error}</Banner>}
                <Field label="School name" htmlFor="school">
                  <input id="school" className="input" value={form.schoolName} onChange={set("schoolName")} placeholder="Riverbank College" required />
                </Field>
                <Field label="First campus" htmlFor="campus">
                  <input id="campus" className="input" value={form.campusName} onChange={set("campusName")} required />
                </Field>
                <div className="row">
                  <Field label="Academic year" htmlFor="year">
                    <input id="year" className="input" value={form.yearName} onChange={set("yearName")} required />
                  </Field>
                  <Field label="First term" htmlFor="term">
                    <input id="term" className="input" value={form.termName} onChange={set("termName")} required />
                  </Field>
                </div>
                <div className="row">
                  <Field label="Term start" htmlFor="ts">
                    <input id="ts" className="input" type="date" value={form.termStart} onChange={set("termStart")} required />
                  </Field>
                  <Field label="Term end" htmlFor="te">
                    <input id="te" className="input" type="date" value={form.termEnd} onChange={set("termEnd")} required />
                  </Field>
                </div>
                <hr style={{ border: "none", borderTop: "1px solid var(--pf-border)", margin: "20px 0" }} />
                <div className="row">
                  <Field label="Your first name" htmlFor="fn">
                    <input id="fn" className="input" value={form.firstName} onChange={set("firstName")} required />
                  </Field>
                  <Field label="Your last name" htmlFor="ln">
                    <input id="ln" className="input" value={form.lastName} onChange={set("lastName")} required />
                  </Field>
                </div>
                <Field label="Email" htmlFor="em">
                  <input id="em" className="input" type="email" value={form.email} onChange={set("email")} placeholder="you@school.edu" required />
                </Field>
                <Field label="Password" hint="At least 8 characters." htmlFor="pw">
                  <input id="pw" className="input" type="password" value={form.password} onChange={set("password")} minLength={8} required />
                </Field>
                <div className="btn-row">
                  <Button type="submit" variant="primary" disabled={busy}>{busy ? "Creating…" : "Create school & continue"}</Button>
                </div>
              </form>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
