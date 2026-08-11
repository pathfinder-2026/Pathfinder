import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type OnboardingState, type Session } from "../api";
import { Banner, Button, Card, Chip, Field, TopBar, Trail } from "../components";

const STEP_LABELS: Record<string, string> = {
  create: "Create school",
  configure: "Configure classes",
  "invite-teachers": "Invite teachers",
  "invite-students": "Invite students",
  "invite-parents": "Invite parents",
  "configure-operations": "Operations",
  "enter-workspace": "Go live",
};

const BRAND_SWATCHES = [
  { name: "Pathfinder", color: "#1f6f63" },
  { name: "Ellenbrook", color: "#2c5f9e" },
  { name: "Riverside", color: "#8a3b5e" },
];

interface Props {
  session: Session;
  displayName: string;
  onBrandingChanged: () => void;
  onEntered: () => void;
  onSignOut: () => void;
}

export function Onboarding({ session, displayName, onBrandingChanged, onEntered, onSignOut }: Props) {
  const [state, setState] = useState<OnboardingState | null>(null);
  const [viewed, setViewed] = useState<string>("create");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const ob = await api.onboarding(session);
    setState(ob);
    return ob;
  }, [session]);

  useEffect(() => {
    void load().then((ob) => setViewed(ob.workspaceEntered ? "enter-workspace" : ob.currentStep));
  }, [load]);

  if (!state) return <div className="center muted">Loading…</div>;

  const advance = async (step: string) => {
    setError(null);
    try {
      await api.completeStep(session, step);
      const ob = await load();
      setViewed(ob.currentStep);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const steps = state.steps.map((k) => ({ key: k, label: STEP_LABELS[k] ?? k }));

  return (
    <div className="app">
      <TopBar title={displayName} roleTag="Administrator · Setup" />
      <main className="main">
        <div className="container">
          <p className="eyebrow">School setup</p>
          <h1>Welcome{state.school.name ? `, ${state.school.name}` : ""}</h1>
          <p className="lede">Follow the trail to get your school ready. Each waypoint saves as you go — you can leave and pick up where you left off.</p>

          <Trail steps={steps} completed={state.completedSteps} current={state.currentStep} onJump={setViewed} />
          {error && <Banner kind="error">{error}</Banner>}

          {viewed === "create" && <CreateStep state={state} onContinue={() => setViewed(state.currentStep)} />}
          {viewed === "configure" && <ConfigureStep session={session} onDone={() => advance("configure")} />}
          {(viewed === "invite-teachers" || viewed === "invite-students" || viewed === "invite-parents") && (
            <InviteStep
              key={viewed}
              session={session}
              role={viewed === "invite-teachers" ? "teacher" : viewed === "invite-students" ? "student" : "parent"}
              onDone={() => advance(viewed)}
            />
          )}
          {viewed === "configure-operations" && (
            <OperationsStep session={session} onBrandingChanged={onBrandingChanged} onDone={() => advance("configure-operations")} />
          )}
          {viewed === "enter-workspace" && <GoLiveStep session={session} onEntered={onEntered} />}

          <div className="btn-row">
            <span className="spacer" />
            <button className="linkish" onClick={onSignOut}>Sign out</button>
          </div>
        </div>
      </main>
    </div>
  );
}

function CreateStep({ state, onContinue }: { state: OnboardingState; onContinue: () => void }) {
  return (
    <Card>
      <div className="card__head">
        <h2 className="section">School created <Chip state="approved">Done</Chip></h2>
        <p className="muted">Your school and administrator account are set up. Continue to configure your classes.</p>
      </div>
      <div className="tiles">
        <div className="tile"><div className="tile__num">{state.counts.classes}</div><div className="tile__label">Classes</div></div>
        <div className="tile"><div className="tile__num">{state.counts.teachers}</div><div className="tile__label">Teachers</div></div>
        <div className="tile"><div className="tile__num">{state.counts.students}</div><div className="tile__label">Students</div></div>
      </div>
      <div className="btn-row">
        <Button variant="primary" onClick={onContinue}>Continue</Button>
      </div>
    </Card>
  );
}

function ConfigureStep({ session, onDone }: { session: Session; onDone: () => void }) {
  const [classes, setClasses] = useState<{ id: string; name: string; yearGroup: string | null }[]>([]);
  const [name, setName] = useState("");
  const [yearGroup, setYearGroup] = useState("8");
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => api.listClasses(session).then(setClasses), [session]);
  useEffect(() => { void refresh(); }, [refresh]);

  const add = async () => {
    setError(null);
    if (!name.trim()) return;
    try {
      await api.createClass(session, name.trim(), yearGroup.trim());
      setName("");
      await refresh();
    } catch (e) { setError((e as Error).message); }
  };

  return (
    <Card>
      <div className="card__head">
        <h2 className="section">Configure classes</h2>
        <p className="muted">Add at least one class. You can add more any time from your workspace.</p>
      </div>
      {error && <Banner kind="error">{error}</Banner>}
      <div className="row">
        <Field label="Class name" htmlFor="cn"><input id="cn" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="8A Mathematics" /></Field>
        <Field label="Year group" htmlFor="yg"><input id="yg" className="input" value={yearGroup} onChange={(e) => setYearGroup(e.target.value)} /></Field>
      </div>
      <Button onClick={add}>Add class</Button>
      {classes.length > 0 && (
        <ul className="people">
          {classes.map((c) => (
            <li className="person" key={c.id}>
              <span className="person__avatar">{c.name.slice(0, 2).toUpperCase()}</span>
              <span>{c.name}</span>
              <span className="person__meta">Year {c.yearGroup ?? "—"}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="btn-row">
        <Button variant="primary" onClick={onDone} disabled={classes.length === 0}>Save & continue</Button>
        {classes.length === 0 && <span className="muted">Add a class to continue</span>}
      </div>
    </Card>
  );
}

function InviteStep({ session, role, onDone }: { session: Session; role: string; onDone: () => void }) {
  const [people, setPeople] = useState<{ id: string; role: string; firstName: string | null; lastName: string | null; email: string | null }[]>([]);
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "" });
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(
    () => api.listInvites(session).then((rows) => setPeople(rows.filter((r) => r.role === role))),
    [session, role],
  );
  useEffect(() => { void refresh(); }, [refresh]);

  const invite = async () => {
    setError(null);
    if (!form.email.trim()) return;
    try {
      await api.invite(session, role, form.email.trim(), form.firstName.trim(), form.lastName.trim());
      setForm({ firstName: "", lastName: "", email: "" });
      await refresh();
    } catch (e) { setError((e as Error).message); }
  };

  const label = role === "teacher" ? "teachers" : role === "student" ? "students" : "parents";
  return (
    <Card>
      <div className="card__head">
        <h2 className="section">Invite {label}</h2>
        <p className="muted">Invitations are delivered through the notification service. You can always invite more later{role === "teacher" ? " — but at least one teacher is recommended before going live" : ""}.</p>
      </div>
      {error && <Banner kind="error">{error}</Banner>}
      <div className="row">
        <Field label="First name" htmlFor="ifn"><input id="ifn" className="input" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} /></Field>
        <Field label="Last name" htmlFor="iln"><input id="iln" className="input" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} /></Field>
      </div>
      <Field label="Email" htmlFor="iem"><input id="iem" className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder={`name@school.edu`} /></Field>
      <Button onClick={invite}>Send invite</Button>
      {people.length > 0 && (
        <ul className="people">
          {people.map((p) => (
            <li className="person" key={p.id}>
              <span className="person__avatar">{(p.firstName ?? "?").slice(0, 1)}{(p.lastName ?? "").slice(0, 1)}</span>
              <span>{p.firstName} {p.lastName}</span>
              <span className="person__meta">{p.email}</span>
              <span className="spacer" /><Chip state="pending">Invited</Chip>
            </li>
          ))}
        </ul>
      )}
      <div className="btn-row">
        <Button variant="primary" onClick={onDone}>Continue</Button>
        <span className="muted">{people.length} invited</span>
      </div>
    </Card>
  );
}

function OperationsStep({ session, onBrandingChanged, onDone }: { session: Session; onBrandingChanged: () => void; onDone: () => void }) {
  const [sg, setSg] = useState({ contactName: "", contactRole: "Designated Safeguarding Lead", slaHours: 24, afterHoursPolicy: "On-call DSL phone" });
  const [sgSaved, setSgSaved] = useState(false);
  const [custom, setCustom] = useState("#1f6f63");
  const [whiteLabel, setWhiteLabel] = useState(false);
  const [productName, setProductName] = useState("");
  const [notice, setNotice] = useState<{ kind: "brand" | "warn" | "error"; text: string } | null>(null);

  const saveSafeguarding = async () => {
    setNotice(null);
    try {
      await api.setSafeguarding(session, sg);
      setSgSaved(true);
    } catch (e) { setNotice({ kind: "error", text: (e as Error).message }); }
  };

  const applyColor = async (color: string) => {
    setNotice(null);
    try {
      await api.setBranding(session, { primaryColor: color });
      onBrandingChanged();
    } catch (e) {
      const msg = e instanceof ApiError && e.code === "BRAND_CONTRAST_FAILED"
        ? `${(e as Error).message}` : (e as Error).message;
      setNotice({ kind: "warn", text: msg });
    }
  };

  const saveWhiteLabel = async () => {
    setNotice(null);
    try {
      await api.setBranding(session, { whiteLabelEnabled: whiteLabel, productName: productName || undefined });
      onBrandingChanged();
      setNotice({ kind: "brand", text: whiteLabel ? "White-label enabled — your name now appears throughout." : "Co-branded with Pathfinder." });
    } catch (e) { setNotice({ kind: "error", text: (e as Error).message }); }
  };

  return (
    <Card>
      <div className="card__head">
        <h2 className="section">Operations & branding</h2>
        <p className="muted">Set your safeguarding contact and make Pathfinder your own.</p>
      </div>
      {notice && <Banner kind={notice.kind}>{notice.text}</Banner>}

      <h3 style={{ margin: "6px 0 2px", fontSize: 14 }}>Safeguarding contact {sgSaved && <Chip state="approved">Saved</Chip>}</h3>
      <p className="muted" style={{ marginBottom: 12 }}>Required before students can use Ask-for-Help.</p>
      <div className="row">
        <Field label="Contact name" htmlFor="sgn"><input id="sgn" className="input" value={sg.contactName} onChange={(e) => setSg({ ...sg, contactName: e.target.value })} /></Field>
        <Field label="Role" htmlFor="sgr"><input id="sgr" className="input" value={sg.contactRole} onChange={(e) => setSg({ ...sg, contactRole: e.target.value })} /></Field>
      </div>
      <div className="row">
        <Field label="Response SLA (hours)" htmlFor="sgh"><input id="sgh" className="input" type="number" value={sg.slaHours} onChange={(e) => setSg({ ...sg, slaHours: Number(e.target.value) })} /></Field>
        <Field label="After-hours policy" htmlFor="sga"><input id="sga" className="input" value={sg.afterHoursPolicy} onChange={(e) => setSg({ ...sg, afterHoursPolicy: e.target.value })} /></Field>
      </div>
      <Button onClick={saveSafeguarding} disabled={!sg.contactName.trim()}>Save safeguarding contact</Button>

      <hr style={{ border: "none", borderTop: "1px solid var(--pf-border)", margin: "24px 0" }} />

      <h3 style={{ margin: "6px 0 2px", fontSize: 14 }}>Brand colour</h3>
      <p className="muted" style={{ marginBottom: 8 }}>Applied instantly. Colours are checked for accessible contrast; an inaccessible pick is adjusted or flagged.</p>
      <div className="swatches">
        {BRAND_SWATCHES.map((s) => (
          <button key={s.color} className="swatch" style={{ background: s.color }} title={s.name} aria-label={`${s.name} colour`} onClick={() => applyColor(s.color)} />
        ))}
        <input type="color" value={custom} onChange={(e) => setCustom(e.target.value)} aria-label="Custom brand colour" style={{ width: 40, height: 34, border: "none", background: "none" }} />
        <Button onClick={() => applyColor(custom)}>Apply custom</Button>
      </div>

      <h3 style={{ margin: "22px 0 2px", fontSize: 14 }}>White-label</h3>
      <label className="field" style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
        <input type="checkbox" checked={whiteLabel} onChange={(e) => setWhiteLabel(e.target.checked)} />
        <span className="field__label" style={{ margin: 0 }}>Show our own name instead of “Pathfinder”</span>
      </label>
      {whiteLabel && (
        <Field label="Product name" htmlFor="pn"><input id="pn" className="input" value={productName} onChange={(e) => setProductName(e.target.value)} placeholder="Riverbank Learning" /></Field>
      )}
      <Button onClick={saveWhiteLabel}>Save branding</Button>

      <div style={{ marginTop: 22, padding: 14, background: "var(--pf-paper)", borderRadius: "var(--pf-radius-md)" }}>
        <p className="muted" style={{ margin: "0 0 8px" }}>These trust signals stay fixed no matter your brand colour:</p>
        <div className="legend">
          <Chip state="draft">Draft</Chip>
          <Chip state="approved">Approved</Chip>
          <Chip state="locked">Computed · locked</Chip>
        </div>
      </div>

      <div className="btn-row">
        <Button variant="primary" onClick={onDone} disabled={!sgSaved}>Continue</Button>
        {!sgSaved && <span className="muted">Save a safeguarding contact to continue</span>}
      </div>
    </Card>
  );
}

function GoLiveStep({ session, onEntered }: { session: Session; onEntered: () => void }) {
  const [warn, setWarn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enter = async (confirmNoTeachers?: boolean) => {
    setError(null);
    try {
      const res = await api.enterWorkspace(session, confirmNoTeachers);
      if (res.ok) return onEntered();
      if (res.requiresConfirmation) return setWarn(true);
      if (res.blocked) setError(`Finish “${res.redirectTo}” first.`);
    } catch (e) { setError((e as Error).message); }
  };

  return (
    <Card>
      <div className="card__head">
        <h2 className="section">Go live</h2>
        <p className="muted">Enter your live workspace. You can keep inviting people and adding content once you're in.</p>
      </div>
      {error && <Banner kind="error">{error}</Banner>}
      {warn && <Banner kind="warn">No teachers have been invited yet. You can proceed, but teachers are what make Pathfinder useful.</Banner>}
      <div className="btn-row">
        {!warn
          ? <Button variant="primary" onClick={() => enter()}>Enter workspace</Button>
          : <Button variant="primary" onClick={() => enter(true)}>Enter anyway</Button>}
      </div>
    </Card>
  );
}
