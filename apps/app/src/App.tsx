import { useCallback, useEffect, useState } from "react";
import { api, clearSession, loadSession, saveSession, type Session } from "./api";
import { applyBrand } from "./brand";
import { Start } from "./screens/Start";
import { Onboarding } from "./screens/Onboarding";
import { Workspace } from "./screens/Workspace";
import { People } from "./screens/People";
import { CsvImport } from "./screens/CsvImport";
import { SsoSettings } from "./screens/SsoSettings";
import { BrandingSettings } from "./screens/BrandingSettings";
import { Structure } from "./screens/Structure";
import { AcceptInvite } from "./screens/AcceptInvite";
import { RoleHome } from "./screens/RoleHome";

export type View =
  | "start" | "onboarding" | "workspace" | "people" | "csv-import" | "sso" | "branding" | "structure"
  | "accept-invite" | "role-home" | "loading";

/** Invite token from the URL (?token=…) — the invitee entry point. */
function inviteToken(): string | null {
  return new URLSearchParams(window.location.search).get("token");
}

export function App() {
  const token = inviteToken();
  const [session, setSession] = useState<Session | null>(() => loadSession());
  const [view, setView] = useState<View>(token ? "accept-invite" : session ? "loading" : "start");
  const [displayName, setDisplayName] = useState("Pathfinder");

  const refreshBranding = useCallback(async (s: Session) => {
    try { const b = await api.getBranding(s); applyBrand(b.primaryColor); setDisplayName(b.displayName); } catch { /* pre-config */ }
  }, []);

  /** Route a session by role: admins get the admin flow, others the role home. */
  const enter = useCallback(async (s: Session) => {
    try {
      const me = await api.me(s);
      if (me.roles.includes("admin")) {
        const ob = await api.onboarding(s);
        setView(ob.workspaceEntered ? "workspace" : "onboarding");
      } else {
        setView("role-home");
      }
    } catch { clearSession(); setSession(null); setView("start"); }
  }, []);

  useEffect(() => {
    if (!session || token) return;
    void refreshBranding(session);
    void enter(session);
  }, [session, token, refreshBranding, enter]);

  const onStarted = (s: Session) => { saveSession(s); setSession(s); setView("loading"); };
  const onAccepted = (s: Session, _roles: string[]) => {
    saveSession(s); setSession(s);
    // Clear the ?token= from the URL so a refresh doesn't re-trigger accept.
    window.history.replaceState({}, "", window.location.pathname);
    void refreshBranding(s); void enter(s);
  };
  const onSignOut = () => {
    clearSession(); setSession(null); setDisplayName("Pathfinder"); applyBrand("#1f6f63");
    window.history.replaceState({}, "", window.location.pathname);
    setView("start");
  };

  if (token && view === "accept-invite") return <AcceptInvite token={token} onAccepted={onAccepted} />;
  if (!session || view === "start") return <Start onStarted={onStarted} />;
  if (view === "loading") return <div className="center muted">Loading…</div>;
  if (view === "role-home") return <RoleHome session={session} displayName={displayName} onSignOut={onSignOut} />;

  const back = () => setView("workspace");
  if (view === "people") return <People session={session} displayName={displayName} onBack={back} onSignOut={onSignOut} />;
  if (view === "csv-import") return <CsvImport session={session} displayName={displayName} onBack={back} onSignOut={onSignOut} />;
  if (view === "sso") return <SsoSettings session={session} displayName={displayName} onBack={back} onSignOut={onSignOut} />;
  if (view === "structure") return <Structure session={session} displayName={displayName} onBack={back} onSignOut={onSignOut} />;
  if (view === "branding") return <BrandingSettings session={session} displayName={displayName} onBrandingChanged={() => refreshBranding(session)} onBack={back} onSignOut={onSignOut} />;
  if (view === "onboarding") {
    return <Onboarding session={session} displayName={displayName} onBrandingChanged={() => refreshBranding(session)} onEntered={() => setView("workspace")} onSignOut={onSignOut} />;
  }
  return <Workspace session={session} displayName={displayName} onNavigate={setView} onSignOut={onSignOut} />;
}
