import { useEffect, useState } from "react";
import { api, type Session } from "../api";
import { Banner, Button, Card, Chip, TopBar } from "../components";

const STEP_COPY: Record<string, { title: string; desc: string }> = {
  profile: { title: "Your profile", desc: "Confirm your details." },
  "review-classes": { title: "Review your classes", desc: "See the classes you teach." },
  "workspace-tour": { title: "Workspace tour", desc: "A quick look around." },
  "select-campuses": { title: "Select campuses", desc: "Choose the campuses you oversee." },
  "dashboard-tour": { title: "Dashboard tour", desc: "How to read your dashboard." },
  "todays-tasks-tour": { title: "Today's tasks", desc: "Where your work appears." },
  "link-child": { title: "Link your child", desc: "Verify your family link." },
};

/**
 * S-ONB-ROLE + role home. Shows the role-appropriate onboarding (FR-ONB-001),
 * including the dual-role union and the "waiting on school setup" hold state.
 * The full persona surface is a later slice; this is the honest landing for now.
 */
export function RoleHome({ session, displayName, onSignOut }: { session: Session; displayName: string; onSignOut: () => void }) {
  const [ob, setOb] = useState<Awaited<ReturnType<typeof api.myOnboarding>> | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [entered, setEntered] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { api.myOnboarding(session).then(setOb).catch((e) => setError((e as Error).message)); }, [session]);

  const role = ob?.roles?.[0] ?? "member";
  const roleTag = ob ? ob.roles.join(" · ") : "Member";

  return (
    <div className="app">
      <TopBar title={displayName} roleTag={roleTag} />
      <main className="main">
        <div className="container">
          {error && <Banner kind="error">{error}</Banner>}
          {!ob ? <div className="muted">Loading…</div>
            : ob.state === "waiting_on_school_setup" ? (
              <>
                <p className="eyebrow">Almost there</p>
                <h1>Your school is being set up</h1>
                <p className="lede">Your administrator is still configuring the school. You'll be able to get started as soon as setup is complete — check back soon.</p>
                <Card><Banner kind="brand">Waiting on school setup. Nothing to do right now.</Banner></Card>
              </>
            ) : entered ? (
              <>
                <p className="eyebrow">Welcome</p>
                <h1>You're all set <Chip state="approved">Active</Chip></h1>
                <p className="lede">Your {role} workspace is being built and will appear here in an upcoming release.</p>
                <Card><ul className="people">
                  <li className="person"><span>Your {role} home</span><span className="spacer" /><Chip state="pending">Coming soon</Chip></li>
                </ul></Card>
              </>
            ) : (
              <>
                <p className="eyebrow">Getting started</p>
                <h1>Welcome{ob.roles.length ? `, ${role}` : ""}</h1>
                <p className="lede">A couple of quick steps tailored to your role.</p>
                <Card>
                  <ul className="people">
                    {ob.steps.map((s) => {
                      const c = STEP_COPY[s] ?? { title: s, desc: "" };
                      return (
                        <li className="person" key={s}>
                          <span>{done.has(s) ? "✓ " : ""}<strong>{c.title}</strong> — <span className="person__meta">{c.desc}</span></span>
                          <span className="spacer" />
                          {done.has(s) ? <Chip state="approved">Done</Chip>
                            : <Button onClick={() => setDone(new Set([...done, s]))}>Mark done</Button>}
                        </li>
                      );
                    })}
                  </ul>
                  <div className="btn-row">
                    <Button variant="primary" onClick={() => setEntered(true)} disabled={done.size < ob.steps.length}>Enter</Button>
                    {done.size < ob.steps.length && <span className="muted">Complete the steps to continue</span>}
                  </div>
                </Card>
              </>
            )}
          <div className="btn-row"><span className="spacer" /><Button variant="ghost" onClick={onSignOut}>Sign out</Button></div>
        </div>
      </main>
    </div>
  );
}
