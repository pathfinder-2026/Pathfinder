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
import { TeacherHome } from "./screens/TeacherHome";
import { TeacherContent } from "./screens/TeacherContent";
import { TeacherAssessments } from "./screens/TeacherAssessments";
import { TeacherDashboard } from "./screens/TeacherDashboard";
import { TeacherInsights } from "./screens/TeacherInsights";
import { TeacherPeer } from "./screens/TeacherPeer";
import { TeacherAgent } from "./screens/TeacherAgent";
import { TeacherTranscripts } from "./screens/TeacherTranscripts";
import { TeacherRecords } from "./screens/TeacherRecords";
import { TeacherCurriculum } from "./screens/TeacherCurriculum";
import { StudentHome } from "./screens/StudentHome";
import { ParentHome } from "./screens/ParentHome";
import { PrincipalHome } from "./screens/PrincipalHome";
import { AuditViewer, DataSubject, SafeguardingSettings, SchoolReports } from "./screens/AdminOps";

export type View =
  | "start" | "onboarding" | "workspace" | "people" | "csv-import" | "sso" | "branding" | "structure"
  | "accept-invite" | "role-home" | "loading"
  | "teacher-home" | "teacher-content" | "teacher-assessments" | "teacher-dashboard" | "teacher-insights" | "teacher-peer"
  | "teacher-agent" | "teacher-transcripts" | "teacher-records" | "teacher-curriculum"
  | "student-home" | "parent-home" | "principal-home"
  | "safeguarding" | "reports" | "audit" | "data-subject";

/** Invite token from the URL (?token=…) — the invitee entry point. */
function inviteToken(): string | null {
  return new URLSearchParams(window.location.search).get("token");
}

/**
 * The workspace a non-admin's roles resolve to. A dual-role Principal-Teacher
 * enters via their Teacher capacity (the M9 transcript rule).
 */
function personaView(roles: string[]): View | undefined {
  return roles.includes("teacher") ? "teacher-home"
    : roles.includes("principal") ? "principal-home"
    : roles.includes("student") ? "student-home"
    : roles.includes("parent") ? "parent-home" : undefined;
}

export function App() {
  const token = inviteToken();
  const [session, setSession] = useState<Session | null>(() => loadSession());
  const [view, setView] = useState<View>(token ? "accept-invite" : session ? "loading" : "start");
  const [displayName, setDisplayName] = useState("Pathfinder");
  const [roles, setRoles] = useState<string[]>([]);

  const refreshBranding = useCallback(async (s: Session) => {
    try { const b = await api.getBranding(s); applyBrand(b.primaryColor); setDisplayName(b.displayName); } catch { /* pre-config */ }
  }, []);

  /** Route a session by role: admins get the admin flow, others their role home. */
  const enter = useCallback(async (s: Session) => {
    try {
      const me = await api.me(s);
      setRoles(me.roles);
      if (me.roles.includes("admin")) {
        const ob = await api.onboarding(s);
        setView(ob.workspaceEntered ? "workspace" : "onboarding");
      } else {
        // Returning users who finished role onboarding go straight to their
        // workspace; only first-timers see the "Getting started" checklist.
        const ob = await api.myOnboarding(s);
        const home = personaView(me.roles);
        setView(ob.state === "ready" && ob.entered && home ? home : "role-home");
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
    // Park on the loading view until enter() resolves the role route — otherwise
    // the render falls through to the admin Workspace default for a moment.
    setView("loading");
    void refreshBranding(s); void enter(s);
  };
  const onSignOut = () => {
    clearSession(); setSession(null); setRoles([]); setDisplayName("Pathfinder"); applyBrand("#1f6f63");
    window.history.replaceState({}, "", window.location.pathname);
    setView("start");
  };

  if (token && view === "accept-invite") return <AcceptInvite token={token} onAccepted={onAccepted} />;
  if (!session || view === "start") return <Start onStarted={onStarted} />;
  if (view === "loading") return <div className="center muted">Loading…</div>;
  if (view === "role-home") {
    // Every persona now has a real workspace.
    const enterView = personaView(roles);
    return <RoleHome session={session} displayName={displayName} onSignOut={onSignOut}
      onEnterWorkspace={enterView ? () => setView(enterView) : undefined} />;
  }

  // ---- Teacher persona (guarded server-side; routed here by role) ----
  const backToTeacher = () => setView("teacher-home");
  if (view === "teacher-home") return <TeacherHome session={session} displayName={displayName} onNavigate={setView} onSignOut={onSignOut} />;
  if (view === "teacher-content") return <TeacherContent session={session} displayName={displayName} onBack={backToTeacher} onSignOut={onSignOut} />;
  if (view === "teacher-assessments") return <TeacherAssessments session={session} displayName={displayName} onBack={backToTeacher} onSignOut={onSignOut} onOpenContent={() => setView("teacher-content")} />;
  if (view === "teacher-dashboard") return <TeacherDashboard session={session} displayName={displayName} onBack={backToTeacher} onSignOut={onSignOut} onOpenInsights={() => setView("teacher-insights")} />;
  if (view === "teacher-insights") return <TeacherInsights session={session} displayName={displayName} onBack={backToTeacher} onSignOut={onSignOut} onOpenContent={() => setView("teacher-content")} />;
  if (view === "teacher-peer") return <TeacherPeer session={session} displayName={displayName} onBack={backToTeacher} onSignOut={onSignOut} />;
  if (view === "teacher-agent") return <TeacherAgent session={session} displayName={displayName} onBack={backToTeacher} onSignOut={onSignOut} />;
  if (view === "teacher-transcripts") return <TeacherTranscripts session={session} displayName={displayName} onBack={backToTeacher} onSignOut={onSignOut} />;
  if (view === "teacher-records") return <TeacherRecords session={session} displayName={displayName} onBack={backToTeacher} onSignOut={onSignOut} />;
  if (view === "teacher-curriculum") return <TeacherCurriculum session={session} displayName={displayName} onBack={backToTeacher} onSignOut={onSignOut} />;

  // ---- Student persona (safety-critical; guarded server-side) ----
  if (view === "student-home") return <StudentHome session={session} displayName={displayName} onSignOut={onSignOut} />;

  // ---- Parent persona (verification-before-data; guarded server-side) ----
  if (view === "parent-home") return <ParentHome session={session} displayName={displayName} onSignOut={onSignOut} />;

  // ---- Principal persona (transcripts unreachable by construction) ----
  if (view === "principal-home") return <PrincipalHome session={session} displayName={displayName} onSignOut={onSignOut} />;

  // ---- Admin persona ----
  const back = () => setView("workspace");
  if (view === "people") return <People session={session} displayName={displayName} onBack={back} onSignOut={onSignOut} />;
  if (view === "csv-import") return <CsvImport session={session} displayName={displayName} onBack={back} onSignOut={onSignOut} />;
  if (view === "sso") return <SsoSettings session={session} displayName={displayName} onBack={back} onSignOut={onSignOut} />;
  if (view === "structure") return <Structure session={session} displayName={displayName} onBack={back} onSignOut={onSignOut} />;
  if (view === "safeguarding") return <SafeguardingSettings session={session} displayName={displayName} onBack={back} onSignOut={onSignOut} />;
  if (view === "reports") return <SchoolReports session={session} displayName={displayName} onBack={back} onSignOut={onSignOut} />;
  if (view === "audit") return <AuditViewer session={session} displayName={displayName} onBack={back} onSignOut={onSignOut} />;
  if (view === "data-subject") return <DataSubject session={session} displayName={displayName} onBack={back} onSignOut={onSignOut} />;
  if (view === "branding") return <BrandingSettings session={session} displayName={displayName} onBrandingChanged={() => refreshBranding(session)} onBack={back} onSignOut={onSignOut} />;
  if (view === "onboarding") {
    return <Onboarding session={session} displayName={displayName} onBrandingChanged={() => refreshBranding(session)} onEntered={() => setView("workspace")} onSignOut={onSignOut} />;
  }
  return <Workspace session={session} displayName={displayName} onNavigate={setView} onSignOut={onSignOut} />;
}
