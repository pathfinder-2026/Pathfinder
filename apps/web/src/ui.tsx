import type { ReactNode } from "react";

export function Loading({ label = "Loading…" }: { label?: string }) {
  return <div className="loading">{label}</div>;
}

export function ErrorBox({ message }: { message: string }) {
  return <div className="callout">Couldn’t load this screen: {message}. Is the API running on :3000?</div>;
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`card card-pad ${className}`}>{children}</div>;
}

export function Stat({ k, v, d, accent }: { k: string; v: ReactNode; d?: string; accent?: boolean }) {
  return (
    <div className={`stat ${accent ? "accent" : ""}`}>
      <div className="k">{k}</div>
      <div className="v">{v}</div>
      {d && <div className="d">{d}</div>}
    </div>
  );
}

const GOV_CLASS: Record<string, string> = {
  draft: "draft", approved: "approved", published: "published",
  signed_off: "signed_off", computed: "computed",
};

export function StatusBadge({ status }: { status: string }) {
  const cls = GOV_CLASS[status] ?? "computed";
  const text = status === "signed_off" ? "Signed off" : status.charAt(0).toUpperCase() + status.slice(1);
  return <span className={`badge ${cls}`}>{text}</span>;
}

export function Avatar({ label }: { label: string }) {
  const initials = label.replace(/[^0-9]/g, "") || label.slice(0, 2);
  return <span className="avatar">{initials}</span>;
}

export function levelDot(level: string): string {
  return level === "low" ? "var(--low-solid)" : level === "developing" ? "var(--dev-solid)" : "var(--secure-solid)";
}
