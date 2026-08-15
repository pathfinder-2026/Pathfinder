import { NotFoundError, ValidationError } from "../domain/errors";
import type { Role } from "../domain/types";
import type { AuditRecorder } from "../platform/audit/auditLog";
import type { Clock } from "../platform/clock";
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
  | { state: "ready"; roles: Role[]; steps: string[]; completedSteps: string[]; entered: boolean };

export type EnterWorkspaceResult =
  | { ok: true; workspaceEntered: true }
  | { ok: false; blocked: true; redirectTo: AdminStep }
  | { ok: false; warning: "no-teachers-invited"; requiresConfirmation: true };

export class OnboardingService {
  constructor(
    private readonly store: DataStore,
    private readonly clock: Clock,
    private readonly audit: AuditRecorder,
  ) {}

  // ---- FR-ONB-001: role-appropriate onboarding for every persona ----

  /**
   * The onboarding flow a user sees, tailored to their role(s). Non-admin
   * personas invited before the Admin has finished school configuration see a
   * "waiting on school setup" state rather than an error. Dual-role users get
   * the union of their roles' steps with shared steps not duplicated.
   */
  async getUserOnboarding(userId: string): Promise<UserOnboarding> {
    const user = await this.store.getUser(userId);
    if (!user) throw new NotFoundError("User not found.");
    const roles = [
      ...new Set((await this.store.listMembershipsByUser(userId)).map((m) => m.role)),
    ] as Role[];
    if (roles.length === 0) throw new ValidationError("User has no role.");

    const school = await this.store.getSchool(user.schoolId);
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
    const progress = await this.store.getUserOnboarding(userId);
    return {
      state: "ready",
      roles,
      steps,
      completedSteps: (progress?.completedSteps ?? []).filter((s) => steps.includes(s)),
      entered: progress?.enteredAt != null,
    };
  }

  /** Mark one of the user's role-onboarding steps complete (FR-ONB-001). */
  async completeUserStep(userId: string, step: string): Promise<UserOnboarding> {
    const onboarding = await this.getUserOnboarding(userId);
    if (onboarding.state !== "ready") {
      throw new ValidationError("Onboarding is not available until school setup is complete.");
    }
    if (!onboarding.steps.includes(step)) {
      throw new ValidationError(`Unknown onboarding step "${step}" for this role.`);
    }
    const progress = (await this.store.getUserOnboarding(userId)) ?? {
      userId,
      completedSteps: [],
      enteredAt: null,
    };
    if (!progress.completedSteps.includes(step)) {
      progress.completedSteps.push(step);
      await this.store.saveUserOnboarding(progress);
      this.audit.append({
        action: "onboarding.user-step.completed",
        actorId: userId,
        subjectType: "user",
        subjectId: userId,
        metadata: { step },
      });
    }
    return this.getUserOnboarding(userId);
  }

  /**
   * Finish role onboarding by entering the workspace. Blocked until every step
   * is complete, so the client can't skip the checklist by calling this early.
   */
  async enterUserWorkspace(
    userId: string,
  ): Promise<{ ok: true; entered: true } | { ok: false; blocked: true; redirectTo: string }> {
    const onboarding = await this.getUserOnboarding(userId);
    if (onboarding.state !== "ready") {
      throw new ValidationError("Onboarding is not available until school setup is complete.");
    }
    const missing = onboarding.steps.find((s) => !onboarding.completedSteps.includes(s));
    if (missing) return { ok: false, blocked: true, redirectTo: missing };

    const progress = (await this.store.getUserOnboarding(userId)) ?? {
      userId,
      completedSteps: [],
      enteredAt: null,
    };
    if (!progress.enteredAt) {
      progress.enteredAt = this.clock.isoNow();
      await this.store.saveUserOnboarding(progress);
      this.audit.append({
        action: "onboarding.user-workspace.entered",
        actorId: userId,
        subjectType: "user",
        subjectId: userId,
        metadata: {},
      });
    }
    return { ok: true, entered: true };
  }

  // ---- FR-ONB-002: the 7-step School-Admin onboarding flow ----

  private async ensureProgress(schoolId: string): Promise<OnboardingProgress> {
    let progress = await this.store.getOnboarding(schoolId);
    if (!progress) {
      progress = { schoolId, completedSteps: [], workspaceEntered: false };
      await this.store.saveOnboarding(progress);
    }
    return progress;
  }

  /** Mark a step complete. All earlier steps must already be complete. */
  async completeStep(schoolId: string, step: AdminStep): Promise<void> {
    const school = await this.store.getSchool(schoolId);
    if (!school) throw new NotFoundError("School not found.");
    const index = ADMIN_STEPS.indexOf(step);
    if (index < 0) throw new ValidationError(`Unknown onboarding step "${step}".`);

    const progress = await this.ensureProgress(schoolId);
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
      await this.store.updateSchool({ ...school, configComplete: true });
    }
    await this.store.saveOnboarding(progress);
    this.audit.append({
      action: "onboarding.step.completed",
      actorId: null,
      subjectType: "school",
      subjectId: schoolId,
      metadata: { step },
    });
  }

  /** The step a returning Admin resumes at: the first incomplete step. */
  async currentStep(schoolId: string): Promise<AdminStep> {
    const progress = await this.ensureProgress(schoolId);
    return this.firstIncompleteStep(progress.completedSteps);
  }

  /**
   * Attempt to navigate to a step. If any earlier required step is incomplete,
   * the jump is blocked and the Admin is returned to the first incomplete step.
   */
  async goToStep(
    schoolId: string,
    target: AdminStep,
  ): Promise<{ blocked: false; step: AdminStep } | { blocked: true; redirectTo: AdminStep }> {
    const progress = await this.ensureProgress(schoolId);
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
  async enterWorkspace(
    schoolId: string,
    options: { confirmNoTeachers?: boolean } = {},
  ): Promise<EnterWorkspaceResult> {
    const school = await this.store.getSchool(schoolId);
    if (!school) throw new NotFoundError("School not found.");
    const progress = await this.ensureProgress(schoolId);

    // All steps up to (not including) "enter-workspace" must be complete.
    for (let i = 0; i < ADMIN_STEPS.length - 1; i++) {
      if (!progress.completedSteps.includes(ADMIN_STEPS[i]!)) {
        return { ok: false, blocked: true, redirectTo: ADMIN_STEPS[i]! };
      }
    }

    const teacherCount = (await this.store.listMembershipsBySchool(schoolId)).filter(
      (m) => m.role === "teacher",
    ).length;
    if (teacherCount === 0 && !options.confirmNoTeachers) {
      return { ok: false, warning: "no-teachers-invited", requiresConfirmation: true };
    }

    if (!progress.completedSteps.includes("enter-workspace")) {
      progress.completedSteps.push("enter-workspace");
    }
    progress.workspaceEntered = true;
    await this.store.saveOnboarding(progress);
    if (!school.configComplete) {
      await this.store.updateSchool({ ...school, configComplete: true });
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
