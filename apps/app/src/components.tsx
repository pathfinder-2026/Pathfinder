import type { ReactNode } from "react";

/** The waypoint "trail" mark — the Pathfinder brand motif. Uses the brand colour. */
export function TrailMark() {
  return (
    <svg viewBox="0 0 26 26" role="img" aria-label="Pathfinder">
      <circle cx="4" cy="20" r="3" fill="var(--pf-brand)" />
      <circle cx="13" cy="10" r="3" fill="var(--pf-brand)" />
      <circle cx="22" cy="4" r="3" fill="none" stroke="var(--pf-brand)" strokeWidth="2" />
      <path d="M4 20 L13 10 L22 4" stroke="var(--pf-brand)" strokeWidth="1.5" fill="none" opacity="0.5" />
    </svg>
  );
}

export function TopBar({ title, roleTag }: { title: string; roleTag?: string }) {
  return (
    <header className="topbar">
      <div className="container topbar__inner">
        <div className="brand">
          <TrailMark />
          {title}
        </div>
        {roleTag && <span className="role-tag">{roleTag}</span>}
      </div>
    </header>
  );
}

export function Card({ children }: { children: ReactNode }) {
  return <section className="card">{children}</section>;
}

/** Standard admin sub-page shell: top bar, back link, title/lede, sign out. */
export function PageShell({
  displayName, title, lede, onBack, onSignOut, children,
}: {
  displayName: string; title: string; lede?: string;
  onBack: () => void; onSignOut: () => void; children: ReactNode;
}) {
  return (
    <div className="app">
      <TopBar title={displayName} roleTag="Administrator" />
      <main className="main">
        <div className="container">
          <button className="linkish" onClick={onBack}>← Back to workspace</button>
          <h1 style={{ marginTop: 10 }}>{title}</h1>
          {lede && <p className="lede">{lede}</p>}
          {children}
          <div className="btn-row"><span className="spacer" /><Button variant="ghost" onClick={onSignOut}>Sign out</Button></div>
        </div>
      </main>
    </div>
  );
}

export function Field({
  label, hint, children, htmlFor,
}: { label: string; hint?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <label className="field" htmlFor={htmlFor}>
      <span className="field__label">{label}</span>
      {children}
      {hint && <span className="field__hint">{hint}</span>}
    </label>
  );
}

export function Button({
  children, onClick, variant = "default", type = "button", disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "default" | "primary" | "ghost";
  type?: "button" | "submit";
  disabled?: boolean;
}) {
  const cls = variant === "primary" ? "btn btn--primary" : variant === "ghost" ? "btn btn--ghost" : "btn";
  return (
    <button className={cls} onClick={onClick} type={type} disabled={disabled}>
      {children}
    </button>
  );
}

export type GovState = "draft" | "approved" | "locked" | "pending";
export function Chip({ state, children }: { state: GovState; children: ReactNode }) {
  return <span className={`chip chip--${state}`}>{children}</span>;
}

export function Banner({ kind = "brand", children }: { kind?: "brand" | "warn" | "error"; children: ReactNode }) {
  return <div className={`banner banner--${kind}`}>{children}</div>;
}

/** The 7-waypoint onboarding trail. Completed + current nodes are navigable. */
export function Trail({
  steps, completed, current, onJump,
}: {
  steps: { key: string; label: string }[];
  completed: string[];
  current: string;
  onJump: (key: string) => void;
}) {
  return (
    <nav className="trail" aria-label="Onboarding progress">
      {steps.map((s, i) => {
        const done = completed.includes(s.key);
        const isCurrent = s.key === current;
        const reachable = done || isCurrent;
        const cls = `trail__node${done ? " done" : ""}${isCurrent ? " current" : ""}`;
        return (
          <button
            key={s.key}
            className={cls}
            disabled={!reachable}
            aria-current={isCurrent ? "step" : undefined}
            onClick={() => reachable && onJump(s.key)}
          >
            <span className="wp" aria-hidden="true">{done ? "✓" : i + 1}</span>
            <span className="trail__label">{s.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
