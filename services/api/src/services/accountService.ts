import { ConflictError, NotFoundError, ValidationError } from "../domain/errors";
import type { Enrolment, Membership, Role, User } from "../domain/types";
import type { AuditRecorder } from "../platform/audit/auditLog";
import type { Clock } from "../platform/clock";
import { newId } from "../platform/ids";
import type { DataStore } from "../ports/dataStore";

export interface CreateAccountInput {
  schoolId: string;
  role: Role;
  email: string;
  firstName: string;
  lastName: string;
  campusId?: string | null;
  classId?: string | null;
  department?: string | null;
  status?: User["status"];
}

/** FR-ADM-002 — manage teacher/student accounts, roles and permissions. */
export class AccountService {
  constructor(
    private readonly store: DataStore,
    private readonly clock: Clock,
    private readonly audit: AuditRecorder,
  ) {}

  /** Create an account with one role membership and its (erasable) PII. */
  createAccount(input: CreateAccountInput, actorId: string | null = null): {
    user: User;
    membership: Membership;
  } {
    if (!input.email?.trim()) throw new ValidationError("Email is required.");
    if (this.store.findUserIdByEmail(input.email)) {
      throw new ConflictError("EMAIL_IN_USE", "An account with this email already exists.");
    }
    const user: User = {
      id: newId(),
      schoolId: input.schoolId,
      status: input.status ?? "active",
      createdAt: this.clock.isoNow(),
    };
    this.store.insertUser(user);
    this.store.upsertPersonalData({
      userId: user.id,
      email: input.email.trim(),
      firstName: input.firstName,
      lastName: input.lastName,
    });
    const membership: Membership = {
      id: newId(),
      userId: user.id,
      schoolId: input.schoolId,
      role: input.role,
      campusId: input.campusId ?? null,
      classId: input.classId ?? null,
      department: input.department ?? null,
    };
    this.store.insertMembership(membership);

    this.audit.append({
      action: "account.created",
      actorId,
      subjectType: "user",
      subjectId: user.id,
      metadata: { role: input.role, schoolId: input.schoolId },
    });
    return { user, membership };
  }

  /**
   * Change a user's role and/or class assignment. Access updates immediately:
   * authorization is evaluated live from memberships on every request, so no
   * re-login is required (see AuthService.authorize).
   */
  changeMembership(
    membershipId: string,
    changes: {
      role?: Role;
      campusId?: string | null;
      classId?: string | null;
      department?: string | null;
    },
    actorId: string | null = null,
  ): Membership {
    const membership = this.store.getMembership(membershipId);
    if (!membership) throw new NotFoundError("Membership not found.");

    // Guard: do not silently strip the last admin via a role change.
    if (membership.role === "admin" && changes.role && changes.role !== "admin") {
      this.assertNotLastAdmin(membership.schoolId, membership.userId);
    }

    const updated: Membership = {
      ...membership,
      role: changes.role ?? membership.role,
      campusId: changes.campusId === undefined ? membership.campusId : changes.campusId,
      classId: changes.classId === undefined ? membership.classId : changes.classId,
      department: changes.department === undefined ? membership.department : changes.department,
    };
    this.store.updateMembership(updated);
    this.audit.append({
      action: "account.membership.changed",
      actorId,
      subjectType: "user",
      subjectId: membership.userId,
      metadata: { membershipId, role: updated.role, classId: updated.classId },
    });
    return updated;
  }

  /**
   * Remove or downgrade an Admin. Blocked if it is the school's only Admin
   * unless another Admin has already been designated.
   */
  removeOrDowngradeAdmin(
    membershipId: string,
    mode: { downgradeTo: Role } | { remove: true },
    actorId: string | null = null,
  ): void {
    const membership = this.store.getMembership(membershipId);
    if (!membership) throw new NotFoundError("Membership not found.");
    if (membership.role !== "admin") {
      throw new ValidationError("Target membership is not an Admin.");
    }
    this.assertNotLastAdmin(membership.schoolId, membership.userId);

    if ("remove" in mode) {
      this.store.deleteMembership(membershipId);
      this.audit.append({
        action: "account.admin.removed",
        actorId,
        subjectType: "user",
        subjectId: membership.userId,
        metadata: { membershipId },
      });
    } else {
      this.store.updateMembership({ ...membership, role: mode.downgradeTo });
      this.audit.append({
        action: "account.admin.downgraded",
        actorId,
        subjectType: "user",
        subjectId: membership.userId,
        metadata: { membershipId, downgradeTo: mode.downgradeTo },
      });
    }
  }

  /**
   * Move a student from their current class to another mid-term. Their active
   * workspace reflects the new class; the closed enrolment is retained so the
   * original class Teacher can still see the student's history.
   */
  transferStudent(studentId: string, toClassId: string, actorId: string | null = null): Enrolment {
    const current = this.store.getActiveEnrolmentForStudent(studentId);
    if (!current) throw new NotFoundError("Student has no active enrolment.");
    const toClass = this.store.getClass(toClassId);
    if (!toClass) throw new NotFoundError("Destination class not found.");
    if (current.classId === toClassId) {
      throw new ValidationError("Student is already enrolled in that class.");
    }

    const originalTeacherId = this.teacherOfClass(current.classId);

    // Close the current enrolment and write it to history (visible to the
    // original Teacher).
    this.store.updateEnrolment({ ...current, active: false });
    this.store.insertEnrolmentHistory({
      id: newId(),
      studentId,
      classId: current.classId,
      teacherId: originalTeacherId,
      endedAt: this.clock.isoNow(),
    });

    const next: Enrolment = {
      id: newId(),
      studentId,
      classId: toClassId,
      schoolId: toClass.schoolId,
      active: true,
    };
    this.store.insertEnrolment(next);

    this.audit.append({
      action: "student.transferred",
      actorId,
      subjectType: "user",
      subjectId: studentId,
      metadata: { fromClassId: current.classId, toClassId, originalTeacherId },
    });
    return next;
  }

  /** Enrol a student into a class (test/setup helper; active enrolment). */
  enrolStudent(studentId: string, classId: string): Enrolment {
    const klass = this.store.getClass(classId);
    if (!klass) throw new NotFoundError("Class not found.");
    const enrolment: Enrolment = {
      id: newId(),
      studentId,
      classId,
      schoolId: klass.schoolId,
      active: true,
    };
    this.store.insertEnrolment(enrolment);
    return enrolment;
  }

  /**
   * Per-student erasure support (Foundational Decision 6): remove the person's
   * PII while retaining the structural id and the append-only audited facts.
   * Milestone 0 establishes the CAPABILITY; the full data-subject request
   * workflow (FR-GOV-006) is delivered in Milestone 11.
   */
  erasePersonalData(userId: string, actorId: string | null = null): void {
    const user = this.store.getUser(userId);
    if (!user) throw new NotFoundError("User not found.");
    this.store.deletePersonalData(userId); // remove the person (PII)
    this.store.updateUser({ ...user, status: "erased" });
    // Retain the immutable record of the action (the audited fact).
    this.audit.append({
      action: "personaldata.erased",
      actorId,
      subjectType: "user",
      subjectId: userId,
      metadata: { erased: true },
    });
  }

  private teacherOfClass(classId: string): string | null {
    const klass = this.store.getClass(classId);
    if (!klass) return null;
    const teacher = this.store
      .listMembershipsBySchool(klass.schoolId)
      .find((m) => m.role === "teacher" && m.classId === classId);
    return teacher?.userId ?? null;
  }

  private assertNotLastAdmin(schoolId: string, excludingUserId: string): void {
    const otherAdmins = this.store
      .listMembershipsBySchool(schoolId)
      .filter((m) => m.role === "admin" && m.userId !== excludingUserId);
    if (otherAdmins.length === 0) {
      throw new ConflictError(
        "LAST_ADMIN",
        "Cannot remove or downgrade the only Admin; designate another Admin first.",
      );
    }
  }
}
