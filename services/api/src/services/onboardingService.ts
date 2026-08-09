import { NotFoundError, ValidationError } from "../domain/errors";
import type { Role } from "../domain/types";
import type { AuditRecorder } from "../platform/audit/auditLog";
import type { DataStore, OnboardingProgress } from "../ports/dataStore";

/** The seven School-Admin onboarding steps, in required order (FR-ONB-002). */
export const ADMIN_STEPS = [
  "create",
  "configure",
  "invite-teachers",
  "invite-students",
  "invite-parents",
  "configure-operations",
  "enter-workspace",
] as const;
export type AdminStep = (typeof ADMIN_STEPS)[number];

/** Per-persona onboarding step templates (FR-ONB-001). "profile" is shared. */
const ROLE_STEPS: Record<Role, string[]> = {
  admin: [...ADMIN_STEPS],
  teacher: ["profile", "review-classes", "workspace-tour"],
  principal: ["profile", "select-campuses", "dashboard-tour"],
  student: ["profile", "todays-tasks-tour"],
  parent: ["profile", "link-child"],
};

export type UserOnboarding =
  | { state: "waiting_on_school_setup"; roles: Role[] }
  | { state: "ready"; roles: Role[]; steps: string[] };

export type EnterWorkspaceResult =
  | { ok: true; workspaceEntered: true }
  | { ok: false; blocked: true; redirectTo: AdminStep }
  | { ok: false; warning: "no-teachers-invited"; requiresConfirmation: true };

export class OnboardingService {
  constructor(
    private readonly store: DataStore,
    private readonly audit: AuditRecorder,
  ) {}

  // ---- FR-ONB-001: role-appropriate onboarding for every persona ----

  /**
   * The onboarding flow a user sees, tailored to their role(s). Non-admin
   * personas invited before the Admin has finished school configuration see a
   * "waiting on school setup" state rather than an error. Dual-role users get
   * the union of their roles' steps with shared steps not duplicated.
   */
  getUserOnboarding(userId: string): UserOnboarding {
    const user = this.store.getUser(userId);
    if (!user) throw new NotFoundError("User not found.");
    const roles = [
      ...new Set(this.store.listMembershipsByUser(userId).map((m) => m.role)),
    ] as Role[];
    if (roles.length === 0) throw new ValidationError("User has no role.");

    const school = this.store.getSchool(user.schoolId);
    const nonAdmin = roles.filter((r) => r !== "admin");
    if (nonAdmin.length > 0 && school && !school.configComplete) {
      return { state: "waiting_on_school_setup", roles };
    }

    // Union of role steps, de-duplicated, preserving first-seen order.
    const steps: string[] = [];
    for (const role of roles) {
      for (const step of ROLE_STEPS[role]) {
        if (!steps.includes(step)) steps.push(step);
      }
    }
    return { state: "ready", roles, steps };
  }

  // ---- FR-ONB-002: the 7-step School-Admin onboarding flow ----

  private ensureProgress(schoolId: string): OnboardingProgress {
    let progress = this.store.getOnboarding(schoolId);
    if (!progress) {
      progress = { schoolId, completedSteps: [], workspaceEntered: false };
      this.store.saveOnboarding(progress);
    }
    return progress;
  }

  /** Mark a step complete. All earlier steps must already be complete. */
  completeStep(schoolId: string, step: AdminStep): void {
    const school = this.store.getSchool(schoolId);
    if (!school) throw new NotFoundError("School not found.");
    const index = ADMIN_STEPS.indexOf(step);
    if (index < 0) throw new ValidationError(`Unknown onboarding step "${step}".`);

    const progress = this.ensureProgress(schoolId);
    for (let i = 0; i < index; i++) {
      if (!progress.completedSteps.includes(ADMIN_STEPS[i]!)) {
        throw new ValidationError(
          `Cannot complete "${step}" before "${ADMIN_STEPS[i]}".`,
        );
      }
    }
    if (!progress.completedSteps.includes(step)) progress.completedSteps.push(step);

    // Finishing "configure" means the school is configured enough for invited
    // personas to onboard (drives FR-ONB-001's waiting state).
    if (step === "configure" && !school.configComplete) {
      this.store.updateSchool({ ...school, configComplete: true });
    }
    this.store.saveOnboarding(progress);
    this.audit.append({
      action: "onboarding.step.completed",
      actorId: null,
      subjectType: "school",
      subjectId: schoolId,
      metadata: { step },
    });
  }

  /** The step a returning Admin resumes at: the first incomplete step. */
  currentStep(schoolId: string): AdminStep {
    const progress = this.ensureProgress(schoolId);
    return this.firstIncompleteStep(progress.completedSteps);
  }

  /**
   * Attempt to navigate to a step. If any earlier required step is incomplete,
   * the jump is blocked and the Admin is returned to the first incomplete step.
   */
  goToStep(
    schoolId: string,
    target: AdminStep,
  ): { blocked: false; step: AdminStep } | { blocked: true; redirectTo: AdminStep } {
    const progress = this.ensureProgress(schoolId);
    const targetIndex = ADMIN_STEPS.indexOf(target);
    for (let i = 0; i < targetIndex; i++) {
      if (!progress.completedSteps.includes(ADMIN_STEPS[i]!)) {
        return { blocked: true, redirectTo: ADMIN_STEPS[i]! };
      }
    }
    return { blocked: false, step: target };
  }

  /**
   * Finish onboarding by entering the workspace. Blocked (with redirect) if a
   * prior step is incomplete. If zero Teachers have actually been invited, the
   * Admin is warned and must confirm before proceeding.
   */
  enterWorkspace(
    schoolId: string,
    options: { confirmNoTeachers?: boolean } = {},
  ): EnterWorkspaceResult {
    const school = this.store.getSchool(schoolId);
    if (!school) throw new NotFoundError("School not found.");
    const progress = this.ensureProgress(schoolId);

    // All steps up to (not including) "enter-workspace" must be complete.
    for (let i = 0; i < ADMIN_STEPS.length - 1; i++) {
      if (!progress.completedSteps.includes(ADMIN_STEPS[i]!)) {
        return { ok: false, blocked: true, redirectTo: ADMIN_STEPS[i]! };
      }
    }

    const teacherCount = this.store
      .listMembershipsBySchool(schoolId)
      .filter((m) => m.role === "teacher").length;
    if (teacherCount === 0 && !options.confirmNoTeachers) {
      return { ok: false, warning: "no-teachers-invited", requiresConfirmation: true };
    }

    if (!progress.completedSteps.includes("enter-workspace")) {
      progress.completedSteps.push("enter-workspace");
    }
    progress.workspaceEntered = true;
    this.store.saveOnboarding(progress);
    if (!school.configComplete) {
      this.store.updateSchool({ ...school, configComplete: true });
    }
    this.audit.append({
      action: "onboarding.workspace.entered",
      actorId: null,
      subjectType: "school",
      subjectId: schoolId,
      metadata: { teacherCount, confirmedNoTeachers: teacherCount === 0 },
    });
    return { ok: true, workspaceEntered: true };
  }

  private firstIncompleteStep(completed: string[]): AdminStep {
    for (const step of ADMIN_STEPS) {
      if (!completed.includes(step)) return step;
    }
    return "enter-workspace";
  }
}
