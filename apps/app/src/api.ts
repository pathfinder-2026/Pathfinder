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

// ---- Teacher workflow types (TCH-1/3/4/5/6) ----

export interface ContentRow {
  id: string;
  title: string;
  status: string;
  rightsAttested: boolean;
  archived: boolean;
  fileType: string | null;
  ingestionStatus: string | null;
  scanStatus: string | null;
  classification: {
    status: string; subject: string; topic: string; year: number;
    difficulty: string; confidence: number; lowConfidence: boolean;
  } | null;
  mappedNodeIds: string[];
  approvalBlockReason: string | null;
  createdAt: string;
}

export type UploadResult =
  | { status: "accepted"; contentItemId: string; versionId: string; flags: string[]; duplicateOfId?: string }
  | { status: "rejected"; reason: string; message: string };

export type SkillsResult =
  | { signedOff: false; hasDraft: boolean }
  | { signedOff: true; versionId: string; versionName: string; nodes: { id: string; label: string; code: string | null; type: string }[] };

export interface AssessmentRow {
  id: string;
  title: string;
  status: string;
  nodeId: string;
  questionCount: number;
  shortfall: { requested: number; generated: number; reason: string } | null;
  reviewAcknowledged: boolean;
  flags: string[];
  publishedAt: string | null;
  createdAt: string;
}

export interface AssessmentDetail {
  id: string;
  title: string;
  status: string;
  nodeId: string;
  shortfall: { requested: number; generated: number; reason: string } | null;
  flags: string[];
  reviewAcknowledged: boolean;
  publishedAt: string | null;
  scheduledStart: string | null;
  questions: {
    id: string; order: number; type: string; prompt: string; options: string[] | null;
    modelAnswer: string | null; rubric: string | null; difficulty: string;
    reviewed: boolean; groundingSources: string[];
  }[];
}

export type GenerateResult =
  | { status: "generated"; assessmentId: string; questionCount: number; shortfall: AssessmentRow["shortfall"]; flags: string[] }
  | { status: "failed"; reason: string };

export interface HeatmapData {
  class: { id: string; name: string };
  enoughData: boolean;
  students: { id: string; label: string }[];
  skills: { id: string; label: string }[];
  cells: { studentId: string; nodeId: string; level: string; score: number; trend: string; insufficientData: boolean; stale: boolean }[];
  flags: { studentId: string; nodeId: string; kind: string }[];
}

export type GraphStatus =
  | { status: "none" }
  | { status: "draft" | "signed_off"; versionId: string; name: string; nodes: number };

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
    request<{ id: string; role: string; status: string; firstName: string | null; lastName: string | null; email: string | null; inviteToken: string | null }[]>(
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

  // ---- Admin: skill-graph curriculum governance (sign-off gate, ADR-0015) ----
  graphStatus: (s: Session) => request<GraphStatus>("GET", `/api/v1/schools/${s.schoolId}/skill-graph`, undefined, s.token),
  importSeedGraph: (s: Session) => request<{ versionId: string; name: string; status: string; nodes: number }>("POST", `/api/v1/schools/${s.schoolId}/skill-graph/import-seed`, {}, s.token),
  signOffGraph: (s: Session, versionId: string) => request<{ versionId: string; status: string }>("POST", `/api/v1/schools/${s.schoolId}/skill-graph/${versionId}/sign-off`, {}, s.token),

  // ---- Teacher: Content Studio (TCH-1) ----
  listContent: (s: Session) => request<ContentRow[]>("GET", `/api/v1/schools/${s.schoolId}/content`, undefined, s.token),
  uploadContent: (s: Session, body: { title: string; fileType: string; text: string }) =>
    request<UploadResult>("POST", `/api/v1/schools/${s.schoolId}/content`, body, s.token),
  contentStep: (s: Session, itemId: string, step: "ingest" | "classify" | "classification/approve" | "attest" | "approve") =>
    request<Record<string, unknown>>("POST", `/api/v1/schools/${s.schoolId}/content/${itemId}/${step}`, {}, s.token),
  mapContent: (s: Session, itemId: string, nodeIds: string[]) =>
    request<{ id: string; nodeId: string; flags: string[] }[]>("POST", `/api/v1/schools/${s.schoolId}/content/${itemId}/map`, { nodeIds }, s.token),
  skills: (s: Session) => request<SkillsResult>("GET", `/api/v1/schools/${s.schoolId}/skills`, undefined, s.token),

  // ---- Teacher: Assessment Builder + publish (TCH-4/5) ----
  listAssessments: (s: Session) => request<AssessmentRow[]>("GET", `/api/v1/schools/${s.schoolId}/assessments`, undefined, s.token),
  generateAssessment: (s: Session, body: { title: string; nodeId: string; count: number; difficulty: string }) =>
    request<GenerateResult>("POST", `/api/v1/schools/${s.schoolId}/assessments/generate`, body, s.token),
  getAssessment: (s: Session, id: string) => request<AssessmentDetail>("GET", `/api/v1/schools/${s.schoolId}/assessments/${id}`, undefined, s.token),
  acknowledgeReview: (s: Session, id: string) => request<{ ok: boolean }>("POST", `/api/v1/schools/${s.schoolId}/assessments/${id}/acknowledge-review`, {}, s.token),
  publishAssessment: (s: Session, id: string) => request<{ status: string; publishedAt: string | null }>("POST", `/api/v1/schools/${s.schoolId}/assessments/${id}/publish`, {}, s.token),
  unpublishAssessment: (s: Session, id: string) => request<{ status: string }>("POST", `/api/v1/schools/${s.schoolId}/assessments/${id}/unpublish`, {}, s.token),

  // ---- Teacher: Dashboard heatmap (TCH-6) ----
  teacherClasses: (s: Session) => request<{ id: string; name: string; yearGroup: string | null }[]>("GET", `/api/v1/schools/${s.schoolId}/teacher/classes`, undefined, s.token),
  heatmap: (s: Session, classId: string) => request<HeatmapData>("GET", `/api/v1/schools/${s.schoolId}/classes/${classId}/heatmap`, undefined, s.token),

  // ---- Teacher: class intelligence (TCH-7/8/9) ----
  focusAreas: (s: Session, classId: string) =>
    request<FocusAreaRow[]>("GET", `/api/v1/schools/${s.schoolId}/classes/${classId}/focus-areas`, undefined, s.token),
  dismissFocusArea: (s: Session, classId: string, nodeId: string) =>
    request<{ ok: boolean }>("POST", `/api/v1/schools/${s.schoolId}/classes/${classId}/focus-areas/${nodeId}/dismiss`, {}, s.token),
  assignFocusMaterial: (s: Session, classId: string, nodeId: string, contentId: string) =>
    request<{ id: string; students: number }>("POST", `/api/v1/schools/${s.schoolId}/classes/${classId}/focus-areas/${nodeId}/assign`, { contentId }, s.token),
  cohorts: (s: Session, classId: string) =>
    request<CohortGroup[]>("GET", `/api/v1/schools/${s.schoolId}/classes/${classId}/cohorts`, undefined, s.token),
  assignCohortWork: (s: Session, classId: string, body: { type: string; nodeId: string | null; studentIds: string[]; contentId?: string | null }) =>
    request<{ id: string; students: number }>("POST", `/api/v1/schools/${s.schoolId}/classes/${classId}/cohorts/assign`, body, s.token),
  adaptive: (s: Session, classId: string) =>
    request<AdaptivePanel>("GET", `/api/v1/schools/${s.schoolId}/classes/${classId}/adaptive`, undefined, s.token),
  nextAction: (s: Session, classId: string, studentId: string, nodeId: string) =>
    request<NextActionResult>("GET", `/api/v1/schools/${s.schoolId}/classes/${classId}/adaptive/next-action?studentId=${encodeURIComponent(studentId)}&nodeId=${encodeURIComponent(nodeId)}`, undefined, s.token),
};

export interface FocusAreaRow {
  nodeId: string;
  nodeLabel: string;
  belowCount: number;
  total: number;
  belowFraction: number;
  contentGap: boolean;
  suggested: { id: string; title: string }[];
}

export interface CohortGroup {
  id: string;
  type: string;
  label: string;
  nodeId: string | null;
  nodeLabel: string | null;
  basis: "current" | "stale";
  staleNote: string | null;
  students: { id: string; label: string }[];
}

export interface AdaptivePanel {
  students: { id: string; label: string }[];
  escalations: { studentId: string; studentLabel: string; nodeId: string; nodeLabel: string; misconception: string; occurrences: number }[];
  reminders: { studentId: string; studentLabel: string; nodeId: string; nodeLabel: string; deferred: boolean; reason: string | null }[];
}

export interface NextActionResult {
  studentId: string;
  nodeId: string;
  action: string;
  escalated: boolean;
  reason: string;
}
