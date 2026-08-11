import { useCallback, useEffect, useState } from "react";
import { api, clearSession, loadSession, saveSession, type Session } from "./api";
import { applyBrand } from "./brand";
import { Start } from "./screens/Start";
import { Onboarding } from "./screens/Onboarding";
import { Workspace } from "./screens/Workspace";

type View = "start" | "onboarding" | "workspace" | "loading";

export function App() {
  const [session, setSession] = useState<Session | null>(() => loadSession());
  const [view, setView] = useState<View>(session ? "loading" : "start");
  const [displayName, setDisplayName] = useState("Pathfinder");

  /** Pull the school's branding and theme the app (brand token only). */
  const refreshBranding = useCallback(async (s: Session) => {
    try {
      const b = await api.getBranding(s);
      applyBrand(b.primaryColor);
      setDisplayName(b.displayName);
    } catch {
      /* pre-config: keep defaults */
    }
  }, []);

  /** Decide whether the admin is still onboarding or already in the workspace. */
  const route = useCallback(async (s: Session) => {
    try {
      const ob = await api.onboarding(s);
      setView(ob.workspaceEntered ? "workspace" : "onboarding");
    } catch {
      clearSession();
      setSession(null);
      setView("start");
    }
  }, []);

  useEffect(() => {
    if (!session) return;
    void refreshBranding(session);
    void route(session);
  }, [session, refreshBranding, route]);

  const onStarted = (s: Session) => {
    saveSession(s);
    setSession(s);
    setView("loading");
  };

  const onSignOut = () => {
    clearSession();
    setSession(null);
    setDisplayName("Pathfinder");
    applyBrand("#1f6f63");
    setView("start");
  };

  if (!session || view === "start") return <Start onStarted={onStarted} />;
  if (view === "loading") return <div className="center muted">Loading…</div>;
  if (view === "workspace") {
    return <Workspace session={session} displayName={displayName} onSignOut={onSignOut} />;
  }
  return (
    <Onboarding
      session={session}
      displayName={displayName}
      onBrandingChanged={() => refreshBranding(session)}
      onEntered={() => setView("workspace")}
      onSignOut={onSignOut}
    />
  );
}
