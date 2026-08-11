/** Thin fetch client for the production /api/v1 surface. */

const TOKEN_KEY = "pf.token";
const SCHOOL_KEY = "pf.schoolId";
const CAMPUS_KEY = "pf.campusId";

export interface Session {
  token: string;
  schoolId: string;
  campusId: string;
}

export function loadSession(): Session | null {
  const token = localStorage.getItem(TOKEN_KEY);
  const schoolId = localStorage.getItem(SCHOOL_KEY);
  const campusId = localStorage.getItem(CAMPUS_KEY);
  return token && schoolId && campusId ? { token, schoolId, campusId } : null;
}

export function saveSession(s: Session): void {
  localStorage.setItem(TOKEN_KEY, s.token);
  localStorage.setItem(SCHOOL_KEY, s.schoolId);
  localStorage.setItem(CAMPUS_KEY, s.campusId);
}

export function clearSession(): void {
  [TOKEN_KEY, SCHOOL_KEY, CAMPUS_KEY].forEach((k) => localStorage.removeItem(k));
}

export class ApiError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown, token?: string): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new ApiError(data.code ?? "ERROR", data.message ?? res.statusText, res.status);
  return data as T;
}

// ---- endpoints ----

export interface OnboardingState {
  steps: string[];
  completedSteps: string[];
  currentStep: string;
  workspaceEntered: boolean;
  school: { name: string; configComplete: boolean };
  counts: { teachers: number; students: number; parents: number; principals: number; classes: number };
}

export interface ResolvedBranding {
  displayName: string;
  primaryColor: string;
  showAttribution: boolean;
  whiteLabel: boolean;
  logo: { available: boolean; url: string | null; fallbackText: string };
}

export interface Account {
  membershipId: string;
  userId: string;
  role: string;
  campusId: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  status: string;
}

export const ROLES = ["admin", "teacher", "student", "parent", "principal"] as const;

export const api = {
  getInvite: (token: string) => request<{ role: string; status: string; schoolName: string | null; firstName: string | null }>("GET", `/api/v1/invites/${token}`),
  acceptInvite: (token: string, password: string) =>
    request<{ token: string; schoolId: string; campusId: string | null; roles: string[] }>("POST", "/api/v1/invites/accept", { token, password }),
  me: (s: Session) => request<{ userId: string; roles: string[]; firstName: string | null }>("GET", "/api/v1/me", undefined, s.token),
  myOnboarding: (s: Session) =>
    request<{ state: "waiting_on_school_setup"; roles: string[] } | { state: "ready"; roles: string[]; steps: string[] }>("GET", "/api/v1/onboarding/me", undefined, s.token),
  login: (email: string, password: string) =>
    request<{ token: string; schoolId: string; campusId: string | null; roles: string[] }>(
      "POST", "/api/v1/auth/login", { email, password },
    ),
  campuses: (s: Session) => request<{ id: string; name: string }[]>("GET", `/api/v1/schools/${s.schoolId}/campuses`, undefined, s.token),
  accounts: (s: Session) => request<Account[]>("GET", `/api/v1/schools/${s.schoolId}/accounts`, undefined, s.token),
  changeRole: (s: Session, membershipId: string, role: string, campusId?: string | null) =>
    request<{ role: string }>("PATCH", `/api/v1/schools/${s.schoolId}/memberships/${membershipId}/role`, { role, campusId }, s.token),
  updateName: (s: Session, userId: string, firstName: string, lastName: string) =>
    request<{ ok: boolean }>("PATCH", `/api/v1/schools/${s.schoolId}/users/${userId}/name`, { firstName, lastName }, s.token),
  importUsers: (s: Session, csv: string) =>
    request<{ totalRows: number; imported: any[]; rejected: { line: number; errors: string[] }[]; duplicates: { line: number; email: string }[]; flaggedForReview: number }>(
      "POST", `/api/v1/schools/${s.schoolId}/import/users`, { csv }, s.token,
    ),
  exportUsers: (s: Session) => request<{ csv: string }>("GET", `/api/v1/schools/${s.schoolId}/export/users`, undefined, s.token),
  getSso: (s: Session) => request<{ provider: string; domain: string } | null>("GET", `/api/v1/schools/${s.schoolId}/sso`, undefined, s.token),
  setSso: (s: Session, provider: string, domain: string) => request<{ provider: string; domain: string }>("POST", `/api/v1/schools/${s.schoolId}/sso`, { provider, domain }, s.token),
  uploadLogo: (s: Session, body: { format: string; sizeBytes: number; svgSource?: string }) => request<{ key: string; format: string }>("POST", `/api/v1/schools/${s.schoolId}/branding/logo`, body, s.token),
  addCampus: (s: Session, name: string) => request<{ id: string; name: string }>("POST", `/api/v1/schools/${s.schoolId}/campuses`, { name }, s.token),
  assignPrincipal: (s: Session, userId: string, campusIds: string[]) => request<{ assigned: number }>("POST", `/api/v1/schools/${s.schoolId}/principals`, { userId, campusIds }, s.token),
  startOnboarding: (payload: unknown) =>
    request<{ token: string; schoolId: string; campusId: string; adminId: string; schoolName: string }>(
      "POST", "/api/v1/onboarding/start", payload,
    ),
  onboarding: (s: Session) => request<OnboardingState>("GET", `/api/v1/schools/${s.schoolId}/onboarding`, undefined, s.token),
  completeStep: (s: Session, step: string) =>
    request<{ ok: boolean; currentStep: string }>("POST", `/api/v1/schools/${s.schoolId}/onboarding/steps/${step}/complete`, {}, s.token),
  createClass: (s: Session, name: string, yearGroup: string) =>
    request<{ id: string }>("POST", `/api/v1/schools/${s.schoolId}/classes`, { campusId: s.campusId, name, yearGroup }, s.token),
  listClasses: (s: Session) => request<{ id: string; name: string; yearGroup: string | null }[]>("GET", `/api/v1/schools/${s.schoolId}/classes`, undefined, s.token),
  invite: (s: Session, role: string, email: string, firstName: string, lastName: string) =>
    request<{ inviteId: string }>("POST", `/api/v1/schools/${s.schoolId}/invites`, { role, email, firstName, lastName }, s.token),
  listInvites: (s: Session) =>
    request<{ id: string; role: string; status: string; firstName: string | null; lastName: string | null; email: string | null }[]>(
      "GET", `/api/v1/schools/${s.schoolId}/invites`, undefined, s.token,
    ),
  setSafeguarding: (s: Session, body: unknown) => request<{ configured: boolean }>("POST", `/api/v1/schools/${s.schoolId}/safeguarding`, body, s.token),
  getBranding: (s: Session) => request<ResolvedBranding>("GET", `/api/v1/schools/${s.schoolId}/branding`, undefined, s.token),
  setBranding: (s: Session, body: unknown) => request<{ primaryColor: string; whiteLabelEnabled: boolean }>("POST", `/api/v1/schools/${s.schoolId}/branding`, body, s.token),
  enterWorkspace: (s: Session, confirmNoTeachers?: boolean) =>
    request<{ ok?: boolean; workspaceEntered?: boolean; warning?: string; requiresConfirmation?: boolean; blocked?: boolean; redirectTo?: string }>(
      "POST", `/api/v1/schools/${s.schoolId}/onboarding/enter-workspace`, { confirmNoTeachers }, s.token,
    ),
  summary: (s: Session) => request<{ schoolName: string; configComplete: boolean; counts: OnboardingState["counts"] }>("GET", `/api/v1/schools/${s.schoolId}/summary`, undefined, s.token),
};
