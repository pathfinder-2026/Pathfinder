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
      // content-type only when a body is actually sent — Fastify rejects e.g. a
      // DELETE that declares JSON but carries nothing (FST_ERR_CTP_EMPTY_JSON_BODY).
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
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

/** Role onboarding for non-admin personas (GET /onboarding/me). */
export type MyOnboarding =
  | { state: "waiting_on_school_setup"; roles: string[] }
  | { state: "ready"; roles: string[]; steps: string[]; completedSteps: string[]; entered: boolean };

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
  classId: string | null;
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
  officialSyllabus: { subject: string; yearLevel: number; sourceUrl: string } | null;
  createdAt: string;
}

export type SyllabusLookup =
  | { found: false }
  | { found: true; item: ContentRow; topics: { nodeId: string; label: string; chain: string[] }[] };

export type UploadResult =
  | { status: "accepted"; contentItemId: string; versionId: string; flags: string[]; duplicateOfId?: string }
  | { status: "rejected"; reason: string; message: string };

export interface SkillNodeRow {
  id: string;
  label: string;
  code: string | null;
  type: string;
  /** Parent in the curriculum hierarchy — drives the cascading skill picker. */
  parentId: string | null;
  /** Which signed-off graph this node came from (a school can have several). */
  versionId?: string;
  subject?: string | null;
  yearLevel?: number | null;
}

export interface SkillGraphSummary {
  versionId: string;
  name: string;
  subject: string | null;
  yearLevel: number | null;
  scopeLabel: string;
}

export type SkillsResult =
  | { signedOff: false; hasDraft: boolean }
  | {
      signedOff: true;
      versionId: string;
      versionName: string;
      /** Every signed-off graph in scope — one per subject × year level. */
      graphs: SkillGraphSummary[];
      nodes: SkillNodeRow[];
    };

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
  targetStudentId: string | null;
  tailoringRationale: string | null;
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
  targetStudentId: string | null;
  tailoringRationale: string | null;
  questions: {
    id: string; order: number; type: string; prompt: string; options: string[] | null;
    modelAnswer: string | null; rubric: string | null; difficulty: string;
    reviewed: boolean; groundingSources: string[];
    teacherEdited: boolean; teacherAuthored: boolean;
  }[];
}

/** A student's attempt at an assessment — the teacher-only grades surface. */
export interface AttemptRow {
  id: string;
  studentId: string;
  studentLabel: string;
  status: string;
  interrupted: boolean;
  savedAnswers: Record<string, string>;
  lastSavedAt: string;
  gradedScore: number | null;
  gradedResults: { questionId: string; score: number; correct: boolean }[] | null;
  gradedAt: string | null;
}

export type GenerateResult =
  | { status: "generated"; assessmentId: string; questionCount: number; shortfall: AssessmentRow["shortfall"]; flags: string[] }
  | { status: "declined"; message: string; pendingContent: { id: string; title: string; status: string }[] }
  | { status: "failed"; reason: string };

/** TCH-19 — generateTailored can also decline (hint/escalate aren't assessments). */
export type TailoredGenerateResult = GenerateResult | { status: "declined"; message: string };

export interface HeatmapData {
  class: { id: string; name: string };
  enoughData: boolean;
  students: { id: string; label: string }[];
  skills: { id: string; label: string }[];
  cells: {
    studentId: string; nodeId: string; level: string; score: number; trend: string;
    insufficientData: boolean; stale: boolean; dataPoints: number;
    /** Shared thin-data rule: "none" | "early" | "established". */
    evidence: string;
  }[];
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
    request<MyOnboarding>("GET", "/api/v1/onboarding/me", undefined, s.token),
  completeMyStep: (s: Session, step: string) =>
    request<MyOnboarding>("POST", `/api/v1/onboarding/me/steps/${step}/complete`, {}, s.token),
  enterMyWorkspace: (s: Session) =>
    request<{ ok: true; entered: true } | { ok: false; blocked: true; redirectTo: string }>(
      "POST", "/api/v1/onboarding/me/enter", {}, s.token),
  login: (email: string, password: string) =>
    request<{ token: string; schoolId: string; campusId: string | null; roles: string[] }>(
      "POST", "/api/v1/auth/login", { email, password },
    ),
  campuses: (s: Session) => request<{ id: string; name: string }[]>("GET", `/api/v1/schools/${s.schoolId}/campuses`, undefined, s.token),
  accounts: (s: Session) => request<Account[]>("GET", `/api/v1/schools/${s.schoolId}/accounts`, undefined, s.token),
  changeRole: (s: Session, membershipId: string, role: string, campusId?: string | null, classId?: string | null) =>
    request<{ role: string }>("PATCH", `/api/v1/schools/${s.schoolId}/memberships/${membershipId}/role`, { role, campusId, classId }, s.token),
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
  /** `classId` narrows to the graph that class teaches (its subject × year). */
  /** Draft a curriculum graph from this approved syllabus (lands as a DRAFT). */
  draftCurriculumFromSyllabus: (s: Session, itemId: string, body?: { subject?: string; yearLevel?: number }) =>
    request<{ versionId: string; name: string; status: string; subject: string | null; yearLevel: number | null; skills: number; strands: number }>(
      "POST", `/api/v1/schools/${s.schoolId}/content/${itemId}/draft-curriculum`, body ?? {}, s.token,
    ),
  curricula: (s: Session) =>
    request<{
      versionId: string; name: string; status: string; subject: string | null;
      yearLevel: number | null; scopeLabel: string; signedOffAt: string | null; concepts: number;
    }[]>("GET", `/api/v1/schools/${s.schoolId}/curricula`, undefined, s.token),
  curriculumDetail: (s: Session, versionId: string) =>
    request<{
      versionId: string;
      strands: { id: string; label: string; concepts: { id: string; label: string }[] }[];
      orphans: { id: string; label: string }[];
    }>("GET", `/api/v1/schools/${s.schoolId}/curricula/${versionId}`, undefined, s.token),
  renameConcept: (s: Session, versionId: string, nodeId: string, label: string) =>
    request<{ id: string; label: string }>(
      "PATCH", `/api/v1/schools/${s.schoolId}/curricula/${versionId}/concepts/${nodeId}`, { label }, s.token,
    ),
  removeConcept: (s: Session, versionId: string, nodeId: string) =>
    request<{ removed: number }>(
      "DELETE", `/api/v1/schools/${s.schoolId}/curricula/${versionId}/concepts/${nodeId}`, undefined, s.token,
    ),
  /** Teachers may sign off a curriculum for their school (2026-08-16 decision). */
  signOffCurriculum: (s: Session, versionId: string) =>
    request<{ versionId: string; status: string; subject: string | null; yearLevel: number | null }>(
      "POST", `/api/v1/schools/${s.schoolId}/skill-graphs/${versionId}/sign-off`, {}, s.token,
    ),
  unmapContent: (s: Session, mappingId: string) =>
    request<{ removed: boolean }>("DELETE", `/api/v1/schools/${s.schoolId}/mappings/${mappingId}`, undefined, s.token),
  contentSections: (s: Session, itemId: string) =>
    request<{ title: string; sections: { heading: string; text: string }[] }>(
      "GET", `/api/v1/schools/${s.schoolId}/content/${itemId}/sections`, undefined, s.token,
    ),
  skills: (s: Session, classId?: string) =>
    request<SkillsResult>(
      "GET", `/api/v1/schools/${s.schoolId}/skills${classId ? `?classId=${encodeURIComponent(classId)}` : ""}`,
      undefined, s.token,
    ),

  // ---- Teacher: official syllabus (ADR-0035) — no NESA API exists, so this
  // tags a Content Studio item as the syllabus for a subject+year and stores
  // the uploader's own reference link; never a generated/guessed URL.
  markOfficialSyllabus: (s: Session, itemId: string, body: { subject: string; yearLevel: number; sourceUrl: string }) =>
    request<{ officialSyllabus: { subject: string; yearLevel: number; sourceUrl: string } }>(
      "POST", `/api/v1/schools/${s.schoolId}/content/${itemId}/mark-official-syllabus`, body, s.token,
    ),
  getSyllabus: (s: Session, subject: string, yearLevel: number) =>
    request<SyllabusLookup>(
      "GET",
      `/api/v1/schools/${s.schoolId}/syllabus?subject=${encodeURIComponent(subject)}&yearLevel=${yearLevel}`,
      undefined,
      s.token,
    ),

  // ---- Teacher: Assessment Builder + publish (TCH-4/5) ----
  listAssessments: (s: Session) => request<AssessmentRow[]>("GET", `/api/v1/schools/${s.schoolId}/assessments`, undefined, s.token),
  assessmentCapacity: (s: Session) => request<Record<string, number>>("GET", `/api/v1/schools/${s.schoolId}/assessment-capacity`, undefined, s.token),
  generateAssessment: (s: Session, body: { title: string; nodeId: string; count: number; difficulty: string }) =>
    request<GenerateResult>("POST", `/api/v1/schools/${s.schoolId}/assessments/generate`, body, s.token),
  getAssessment: (s: Session, id: string) => request<AssessmentDetail>("GET", `/api/v1/schools/${s.schoolId}/assessments/${id}`, undefined, s.token),
  listAttempts: (s: Session, assessmentId: string) =>
    request<AttemptRow[]>("GET", `/api/v1/schools/${s.schoolId}/assessments/${assessmentId}/attempts`, undefined, s.token),
  assignWork: (s: Session, body: {
    studentIds: string[]; classId?: string | null; type: "homework" | "practice" | "assessment";
    title: string; nodeId?: string | null; assessmentId?: string | null; contentId?: string | null;
    dueDate: string; baseline?: boolean;
  }) => request<{ assigned: number }>("POST", `/api/v1/schools/${s.schoolId}/assignments`, body, s.token),
  skillStanding: (s: Session, classId: string, nodeId: string) =>
    request<{ studentId: string; label: string; score: number | null; belowMastery: boolean; noData: boolean }[]>(
      "GET", `/api/v1/schools/${s.schoolId}/classes/${classId}/skill-standing?nodeId=${encodeURIComponent(nodeId)}`,
      undefined, s.token,
    ),
  editQuestion: (s: Session, assessmentId: string, questionId: string, changes: { prompt?: string; options?: string[] | null; modelAnswer?: string | null; rubric?: string | null }) =>
    request<{ id: string }>("PATCH", `/api/v1/schools/${s.schoolId}/assessments/${assessmentId}/questions/${questionId}`, changes, s.token),
  deleteQuestion: (s: Session, assessmentId: string, questionId: string) =>
    request<{ ok: boolean }>("DELETE", `/api/v1/schools/${s.schoolId}/assessments/${assessmentId}/questions/${questionId}`, undefined, s.token),
  createManualAssessment: (s: Session, body: { title: string; nodeId: string; questions: { prompt: string; modelAnswer?: string | null }[] }) =>
    request<{ assessmentId: string; questionCount: number }>("POST", `/api/v1/schools/${s.schoolId}/assessments/manual`, body, s.token),
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
  /** TCH-19 — draft an assessment tailored to this student's own recommendation. Always a draft; review + publish are unchanged. */
  generateTailoredAssessment: (s: Session, classId: string, studentId: string, nodeId: string) =>
    request<TailoredGenerateResult>(
      "POST",
      `/api/v1/schools/${s.schoolId}/classes/${classId}/students/${studentId}/assessments/generate-tailored`,
      { nodeId },
      s.token,
    ),

  // ---- Teacher: peer suite (TCH-10..12) ----
  classStudents: (s: Session, classId: string) =>
    request<{ id: string; label: string }[]>("GET", `/api/v1/schools/${s.schoolId}/classes/${classId}/students`, undefined, s.token),
  listPeerTests: (s: Session) => request<PeerTestRow[]>("GET", `/api/v1/schools/${s.schoolId}/peer-tests`, undefined, s.token),
  buildPeerTest: (s: Session, body: {
    title: string; nodeId: string; questionCount: number; rubric?: string | null;
    cohort: string[]; anonymity: "named" | "anonymous"; accommodations?: { studentId: string; kind: string }[];
  }) => request<PeerTestRow>("POST", `/api/v1/schools/${s.schoolId}/peer-tests`, body, s.token),
  peerTestAction: (s: Session, id: string, action: "launch" | "cancel" | "close" | "publish-benchmark" | "withhold-benchmark", body: Record<string, unknown> = {}) =>
    request<PeerTestRow>("POST", `/api/v1/schools/${s.schoolId}/peer-tests/${id}/${action}`, body, s.token),
  peerCorrection: (s: Session, id: string, body: { studentId: string; correctedScore: number; reason: string }) =>
    request<{ ok: boolean }>("POST", `/api/v1/schools/${s.schoolId}/peer-tests/${id}/corrections`, body, s.token),
  peerResults: (s: Session, id: string) => request<PeerResults>("GET", `/api/v1/schools/${s.schoolId}/peer-tests/${id}/results`, undefined, s.token),
  peerPendingReviews: (s: Session, id: string) =>
    request<{ anonymityRisk: boolean; reviews: { id: string; text: string; createdAt: string }[] }>("GET", `/api/v1/schools/${s.schoolId}/peer-tests/${id}/reviews/pending`, undefined, s.token),
  moderateReview: (s: Session, reviewId: string, decision: "approve" | "reject") =>
    request<{ id: string; moderationState: string }>("POST", `/api/v1/schools/${s.schoolId}/peer-reviews/${reviewId}/moderate`, { decision }, s.token),

  // ---- Teacher: Agent drafts (TCH-13) + help transcripts (TCH-14) ----
  listAgentSuggestions: (s: Session) => request<AgentSuggestionRow[]>("GET", `/api/v1/schools/${s.schoolId}/agent/suggestions`, undefined, s.token),
  agentGenerate: (s: Session, body: {
    kind: "unit_sequence" | "lesson_plan" | "differentiation" | "parent_summary" | "feedback";
    nodeId: string; term?: string; topic?: string; classId?: string; studentId?: string;
    observations?: { category: string; text: string }[];
  }) => request<AgentGenerateResult>("POST", `/api/v1/schools/${s.schoolId}/agent/generate`, body, s.token),
  editAgentDraft: (s: Session, id: string, content: string) =>
    request<AgentSuggestionRow>("PATCH", `/api/v1/schools/${s.schoolId}/agent/suggestions/${id}`, { content }, s.token),
  helpSessions: (s: Session) =>
    request<{
      sessionId: string; taskTitle: string; studentLabel: string; createdAt: string;
      /** Triage signals so a teacher can prioritise without opening each one. */
      messageCount: number; refusals: number; safeguarding: boolean;
    }[]>("GET", `/api/v1/schools/${s.schoolId}/help-sessions`, undefined, s.token),
  helpTranscript: (s: Session, sessionId: string) =>
    request<{ role: "student" | "assistant"; kind: string; text: string; at: string }[]>("GET", `/api/v1/schools/${s.schoolId}/help-sessions/${sessionId}/transcript`, undefined, s.token),

  // ---- Teacher: content detail + mapping overrides (TCH-2 / full TCH-3) ----
  contentVersions: (s: Session, itemId: string) =>
    request<{ id: string; versionNumber: number; fileType: string; sizeBytes: number; current: boolean }[]>("GET", `/api/v1/schools/${s.schoolId}/content/${itemId}/versions`, undefined, s.token),
  setContentShare: (s: Session, itemId: string, share: { type: "private" } | { type: "class"; classId: string } | { type: "department"; department: string }) =>
    request<{ share: { type: string } }>("POST", `/api/v1/schools/${s.schoolId}/content/${itemId}/share`, share, s.token),
  contentMappings: (s: Session, itemId: string) =>
    request<MappingRow[]>("GET", `/api/v1/schools/${s.schoolId}/content/${itemId}/mappings`, undefined, s.token),
  overrideMapping: (s: Session, mappingId: string, newNodeId: string, remapHistorical?: boolean) =>
    request<OverrideOutcome>("POST", `/api/v1/schools/${s.schoolId}/mappings/${mappingId}/override`, { newNodeId, remapHistorical }, s.token),

  // ---- Teacher: reports, records, calendar (TCH-15/16/18) ----
  growthReport: (s: Session, classId: string) =>
    request<{
      classId: string; className: string; limited: boolean; note: string | null;
      growth: {
        nodeId: string; nodeLabel: string; baseline: number; current: number; change: number;
        /** False → no starting point recorded, so no growth to report. */
        hasBaseline: boolean; dataPoints: number;
      }[];
    }>(
      "GET", `/api/v1/schools/${s.schoolId}/classes/${classId}/growth-report`, undefined, s.token,
    ),
  studentRecords: (s: Session, studentId: string) =>
    request<{ behavioural: { visibility: string; notes: { id: string; category: string; note: string; createdAt: string }[] }; coCurricular: { id: string; domain: string; skill: string; level: string; createdAt: string }[] }>(
      "GET", `/api/v1/schools/${s.schoolId}/students/${studentId}/records`, undefined, s.token,
    ),
  recordBehavioural: (s: Session, studentId: string, category: string, note: string) =>
    request<{ id: string }>("POST", `/api/v1/schools/${s.schoolId}/students/${studentId}/behavioural`, { category, note }, s.token),
  recordCoCurricular: (s: Session, studentId: string, body: { domain: string; skill: string; level: string }) =>
    request<{ id: string }>("POST", `/api/v1/schools/${s.schoolId}/students/${studentId}/cocurricular`, body, s.token),
  teacherCalendar: (s: Session) =>
    request<{ id: string; title: string; type: string; eventDate: string; yearGroup: string | null; changed: boolean }[]>("GET", `/api/v1/schools/${s.schoolId}/calendar`, undefined, s.token),
  createCalendarEvent: (s: Session, body: { title: string; type: string; eventDate: string; yearGroup?: string | null }) =>
    request<{ id: string }>("POST", `/api/v1/schools/${s.schoolId}/calendar`, body, s.token),
  rescheduleCalendarEvent: (s: Session, eventId: string, newDate: string) =>
    request<{ id: string; eventDate: string; changed: boolean }>("POST", `/api/v1/schools/${s.schoolId}/calendar/${eventId}/reschedule`, { newDate }, s.token),
  configureBehaviouralConsent: (s: Session) =>
    request<{ configured: boolean }>("POST", `/api/v1/schools/${s.schoolId}/behavioural/consent`, {}, s.token),

  // ---- Teacher: assign work to a student ----
  assignTask: (s: Session, body: { studentId: string; classId?: string | null; type: "homework" | "practice" | "assessment"; title: string; nodeId?: string | null; assessmentId?: string | null; dueDate: string }) =>
    request<{ id: string; title: string; type: string; dueDate: string }>("POST", `/api/v1/schools/${s.schoolId}/tasks`, body, s.token),

  // ---- Student (STU-1..4, safety-critical) ----
  studentWorkspace: (s: Session) => request<StudentWorkspaceView>("GET", `/api/v1/schools/${s.schoolId}/student/workspace`, undefined, s.token),
  studentTask: (s: Session, taskId: string) =>
    request<{
      id: string; type: string; title: string; dueDate: string; status: string; assessmentId: string | null;
      baseline: boolean;
      material: { title: string; sections: { heading: string; text: string }[] } | null;
      materialWithdrawn: boolean;
    }>("GET", `/api/v1/schools/${s.schoolId}/student/tasks/${taskId}`, undefined, s.token),
  completeStudentTask: (s: Session, taskId: string) =>
    request<{ id: string; status: string }>("POST", `/api/v1/schools/${s.schoolId}/student/tasks/${taskId}/complete`, {}, s.token),
  askForHelp: (s: Session, taskId: string, message: string) =>
    request<HelpReply>("POST", `/api/v1/schools/${s.schoolId}/student/tasks/${taskId}/help`, { message }, s.token),
  studentCalendar: (s: Session) =>
    request<{ id: string; title: string; type: string; date: string; changed: boolean }[]>("GET", `/api/v1/schools/${s.schoolId}/student/calendar`, undefined, s.token),
  studentAssessment: (s: Session, assessmentId: string) =>
    request<{ id: string; title: string; questions: { id: string; order: number; type: string; prompt: string; options: string[] | null }[] }>(
      "GET", `/api/v1/schools/${s.schoolId}/student/assessments/${assessmentId}`, undefined, s.token,
    ),
  startAttempt: (s: Session, assessmentId: string) =>
    request<{ id: string; status: string; savedAnswers: Record<string, string> }>("POST", `/api/v1/schools/${s.schoolId}/student/assessments/${assessmentId}/attempts`, {}, s.token),
  saveAttempt: (s: Session, attemptId: string, answers: Record<string, string>) =>
    request<{ lastSavedAt: string }>("POST", `/api/v1/schools/${s.schoolId}/student/attempts/${attemptId}/save`, { answers }, s.token),
  markAttemptInterrupted: (s: Session, attemptId: string) =>
    request<{ ok: boolean }>("POST", `/api/v1/schools/${s.schoolId}/student/attempts/${attemptId}/interrupted`, {}, s.token),
  resumeAttempt: (s: Session, attemptId: string) =>
    request<{ resumable: boolean; savedAnswers: Record<string, string> }>("GET", `/api/v1/schools/${s.schoolId}/student/attempts/${attemptId}/resume`, undefined, s.token),
  submitAttempt: (s: Session, attemptId: string, answers: Record<string, string>) =>
    request<{ id: string; status: string }>("POST", `/api/v1/schools/${s.schoolId}/student/attempts/${attemptId}/submit`, { answers }, s.token),

  // ---- Student: peer tests (STU-5) ----
  studentPeerTests: (s: Session) =>
    request<{ peerTestId: string; title: string; placedAt: string }[]>("GET", `/api/v1/schools/${s.schoolId}/student/peer-tests`, undefined, s.token),
  studentPeerTest: (s: Session, peerTestId: string) =>
    request<{ id: string; title: string; questionCount: number; rubric: string | null; status: string; peers: { id: string; label: string }[]; signal: { visible: boolean; signal: string | null; message: string } }>(
      "GET", `/api/v1/schools/${s.schoolId}/student/peer-tests/${peerTestId}`, undefined, s.token,
    ),
  submitPeerReview: (s: Session, peerTestId: string, targetStudentId: string, text: string) =>
    request<{ ok: boolean; message: string }>("POST", `/api/v1/schools/${s.schoolId}/student/peer-tests/${peerTestId}/reviews`, { targetStudentId, text }, s.token),
  studentPeerFeedback: (s: Session) =>
    request<{ hasFeedback: boolean; reviews: { text: string }[]; message: string }>("GET", `/api/v1/schools/${s.schoolId}/student/peer-feedback`, undefined, s.token),
  recordPeerSubmission: (s: Session, peerTestId: string, studentId: string, score: number) =>
    request<{ ok: boolean }>("POST", `/api/v1/schools/${s.schoolId}/peer-tests/${peerTestId}/submissions`, { studentId, score }, s.token),

  // ---- Parent (PAR-1..5) ----
  parentChildren: (s: Session) =>
    request<{ studentId: string; childName: string | null; yearGroup: string | null }[]>("GET", `/api/v1/schools/${s.schoolId}/parent/children`, undefined, s.token),
  parentDashboard: (s: Session, studentId: string) =>
    request<{ childName: string | null; hasRecentActivity: boolean; strengths: string[]; focusAreas: string[]; recentActivity: string[]; summaryText: string; period: string }>(
      "GET", `/api/v1/schools/${s.schoolId}/parent/children/${studentId}/dashboard`, undefined, s.token,
    ),
  parentCalendar: (s: Session, studentId: string) =>
    request<{ id: string; title: string; type: string; date: string; changed: boolean }[]>("GET", `/api/v1/schools/${s.schoolId}/parent/children/${studentId}/calendar`, undefined, s.token),
  parentReport: (s: Session, studentId: string) =>
    request<{ childName: string | null; strengths: string[]; focusAreas: string[]; teacherComments: string[]; coCurricular: { domain: string; skill: string; level: string }[] }>(
      "GET", `/api/v1/schools/${s.schoolId}/parent/children/${studentId}/report`, undefined, s.token,
    ),
  parentDigests: (s: Session) =>
    request<{ subject: string; body: string; at: string }[]>("GET", `/api/v1/schools/${s.schoolId}/parent/digests`, undefined, s.token),

  // ---- Admin: parent links (PAR-1) + digest trigger ----
  listParentLinks: (s: Session) =>
    request<{ id: string; parentLabel: string; childLabel: string; relationship: string; verified: boolean }[]>("GET", `/api/v1/schools/${s.schoolId}/parent-links`, undefined, s.token),
  createParentLink: (s: Session, parentId: string, studentId: string, relationship: string) =>
    request<{ id: string; verified: boolean }>("POST", `/api/v1/schools/${s.schoolId}/parent-links`, { parentId, studentId, relationship }, s.token),
  verifyParentLink: (s: Session, linkId: string) =>
    request<{ id: string; verified: boolean }>("POST", `/api/v1/schools/${s.schoolId}/parent-links/${linkId}/verify`, {}, s.token),
  runParentDigest: (s: Session) =>
    request<{ sent: number; skippedNoActivity: number }>("POST", `/api/v1/schools/${s.schoolId}/parent-digest/run`, {}, s.token),

  // ---- Principal (PRB-1..5) ----
  principalTeacherReport: (s: Session) => request<PrincipalTeacherReport>("GET", `/api/v1/schools/${s.schoolId}/principal/teacher-report`, undefined, s.token),
  principalMastery: (s: Session) =>
    request<{ classes: { classId: string; name: string; studentCount: number; avgScore: number; belowMasteryFraction: number; atRiskCount: number; outlier: boolean }[]; schoolWide: { avgScore: number; atRiskCount: number; classCount: number } }>(
      "GET", `/api/v1/schools/${s.schoolId}/principal/mastery`, undefined, s.token,
    ),
  principalDrillClass: (s: Session, classId: string) =>
    request<{ classId: string; name: string; students: { studentId: string; name: string | null; avgScore: number; atRisk: boolean }[] }>(
      "GET", `/api/v1/schools/${s.schoolId}/principal/classes/${classId}`, undefined, s.token,
    ),
  principalDrillStudent: (s: Session, studentId: string) =>
    request<{ studentId: string; name: string | null; avgScore: number; skills: { nodeId: string; score: number; level: string }[]; tasksCompleted: number; askForHelpExcluded: true }>(
      "GET", `/api/v1/schools/${s.schoolId}/principal/students/${studentId}`, undefined, s.token,
    ),
  principalAlerts: (s: Session) =>
    request<{ kind: string; classId: string; message: string; delta: number }[]>("GET", `/api/v1/schools/${s.schoolId}/principal/alerts`, undefined, s.token),
  setPrincipalPolicy: (s: Session, teacherComparisonEnabled: boolean) =>
    request<{ teacherComparisonEnabled: boolean }>("POST", `/api/v1/schools/${s.schoolId}/principal-policy`, { teacherComparisonEnabled }, s.token),

  // ---- Admin operations (ADM-8..11) + notifications (S-NOTIF) ----
  getSafeguarding: (s: Session) =>
    request<{ configured: boolean; contactName?: string; contactRole?: string; slaHours?: number; afterHoursPolicy?: string }>("GET", `/api/v1/schools/${s.schoolId}/safeguarding`, undefined, s.token),
  schoolReport: (s: Session, month?: string) =>
    request<{ performance: { avgScore: number; classCount: number; atRiskCount: number }; coverage: number; usage: { assessmentsGenerated: number; agentDrafts: number }; cost: { month: string; lines: { licenceId: string; seats: number; monthlyRate: number; proratedCost: number; prorated: boolean }[]; total: number } }>(
      "GET", `/api/v1/schools/${s.schoolId}/report${month ? `?month=${month}` : ""}`, undefined, s.token,
    ),
  addLicence: (s: Session, body: { seats: number; monthlyRate: number; startDate: string; endDate?: string | null }) =>
    request<{ id: string; seats: number }>("POST", `/api/v1/schools/${s.schoolId}/licences`, body, s.token),
  auditLog: (s: Session, offset = 0, limit = 50) =>
    request<{ chainVerified: boolean; total: number; entries: { seq: number; at: string; action: string; actorId: string | null; subjectType: string; subjectId: string }[] }>(
      "GET", `/api/v1/schools/${s.schoolId}/audit?offset=${offset}&limit=${limit}`, undefined, s.token,
    ),
  exportStudent: (s: Session, studentId: string) =>
    request<Record<string, unknown>>("GET", `/api/v1/schools/${s.schoolId}/students/${studentId}/export`, undefined, s.token),
  eraseStudent: (s: Session, studentId: string, confirm?: boolean) =>
    request<{ erased: boolean; requiresConfirmation?: boolean; affected?: { activeEnrolment: boolean; tasks: number } }>(
      "POST", `/api/v1/schools/${s.schoolId}/students/${studentId}/erase`, { confirm }, s.token,
    ),
  notifications: (s: Session) =>
    request<{ id: string; type: string; subject: string; body: string; at: string }[]>("GET", "/api/v1/notifications", undefined, s.token),
  handoverClass: (s: Session, fromTeacherId: string, toTeacherId: string) =>
    request<{ classId: string | null; tasksTransferred: number; helpSessionsTransferred: number }>("POST", `/api/v1/schools/${s.schoolId}/handover`, { fromTeacherId, toTeacherId }, s.token),
};

export interface PrincipalTeacherReport {
  teachers: {
    teacherId: string; name: string | null; coverage: number; assessmentsAuthored: number;
    assessmentsPublished: number; aiApprovalRate: number; editRate: number; engagement: number;
    workload: number; newTeacher: boolean; windowDays: number; lowEngagementOutlier: boolean;
  }[];
  schoolWide: { teacherCount: number; avgEngagement: number; avgAiApprovalRate: number; coverage: number };
  comparison: { ranking: { teacherId: string; name: string | null; engagement: number }[] } | null;
}

export interface StudentTaskView {
  id: string;
  type: string;
  title: string;
  dueDate: string;
  status: string;
  completed: boolean;
  overdue: boolean;
  /** A baseline check-in — rendered as planning help, never a graded test. */
  baseline?: boolean;
}

export interface StudentWorkspaceView {
  hasTasks: boolean;
  today: StudentTaskView[];
  thisWeek: StudentTaskView[];
  emptyMessage: string | null;
}

export type HelpReply =
  | { available: true; kind: string; message: string }
  | { available: false; reason: string; message: string };

export interface MappingRow {
  mappingId: string;
  nodeId: string;
  overriddenFromNodeId: string | null;
  source: string;
  flags: string[];
  chain: string[];
}

export type OverrideOutcome =
  | { requiresDecision: true; prompt: string; oldNodeId: string; newNodeId: string }
  | { requiresDecision: false; mapping: { nodeId: string } };

export interface AgentSuggestionRow {
  id: string;
  kind: string;
  title: string;
  content: string;
  grounding: { title: string; archived: boolean }[];
  sensitiveSections: { category: string; text: string; flaggedForReview: boolean }[];
  requiresExtraReview: boolean;
  personalised: boolean;
  personalisationNote: string | null;
  sent: boolean;
  edited: boolean;
  createdAt: string;
}

export type AgentGenerateResult =
  | { status: "declined"; reason: string; message: string }
  | { status: "suggested"; suggestion: AgentSuggestionRow };

export interface PeerTestRow {
  id: string;
  title: string;
  nodeId: string;
  questionCount: number;
  cohortSize: number;
  cohort: string[];
  anonymity: "named" | "anonymous";
  accommodations: number;
  status: "draft" | "scheduled" | "launched" | "closed" | "cancelled";
  benchmarkPublish: "withheld" | "published";
  scheduledStart: string | null;
  warnings: string[];
  createdAt: string;
}

export interface PeerResults {
  completion: { completed: number; total: number; rate: number };
  publishState: "withheld" | "published";
  requiresPublishDecision: boolean;
  benchmark: {
    suppressed: boolean;
    suppressionReason: string | null;
    students: { studentId: string; label: string; score: number; percentile: number; band: "above" | "at" | "below" }[];
  };
}

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
  /** Evidence behind it — same rule the heatmap renders ("early" = thin). */
  evidence: "none" | "early" | "established";
}
