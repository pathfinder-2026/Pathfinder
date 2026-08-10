import { ConflictError, NotFoundError, ValidationError } from "../domain/errors";
import type { Invite, Role, User } from "../domain/types";
import type { AuditRecorder } from "../platform/audit/auditLog";
import type { Clock } from "../platform/clock";
import { newId, newToken } from "../platform/ids";
import type {
  NotificationService,
  NotificationType,
} from "../platform/notifications/notificationService";
import type { DataStore } from "../ports/dataStore";

export interface InviteInput {
  email: string;
  firstName: string;
  lastName: string;
}

export interface InviteResult {
  invite: Invite;
  user: User;
  /** Id of the notification emitted through the notification service. */
  notificationId: string;
}

const INVITE_NOTIFICATION: Record<Role, NotificationType | undefined> = {
  teacher: "invite.teacher",
  student: "invite.student",
  parent: "invite.parent",
  admin: undefined,
  principal: undefined,
};

/**
 * Invites are the FIRST consumer of the single notification/event service
 * (Milestone 0). The invite email is delivered through
 * NotificationService.send(), never via ad-hoc email code.
 */
export class InviteService {
  constructor(
    private readonly store: DataStore,
    private readonly clock: Clock,
    private readonly audit: AuditRecorder,
    private readonly notifications: NotificationService,
  ) {}

  inviteTeacher(
    schoolId: string,
    input: InviteInput,
    actorId: string | null = null,
  ): Promise<InviteResult> {
    return this.invite(schoolId, "teacher", input, actorId);
  }

  async invite(
    schoolId: string,
    role: Role,
    input: InviteInput,
    actorId: string | null = null,
  ): Promise<InviteResult> {
    const school = await this.store.getSchool(schoolId);
    if (!school) throw new NotFoundError("School not found.");
    const notificationType = INVITE_NOTIFICATION[role];
    if (!notificationType) throw new ValidationError(`Role "${role}" is not invitable.`);
    if (!input.email?.trim()) throw new ValidationError("Email is required.");
    if (await this.store.findUserIdByEmail(input.email)) {
      throw new ConflictError("EMAIL_IN_USE", "An account with this email already exists.");
    }

    const now = this.clock.isoNow();
    const user: User = { id: newId(), schoolId, status: "invited", createdAt: now };
    await this.store.insertUser(user);
    await this.store.upsertPersonalData({
      userId: user.id,
      email: input.email.trim(),
      firstName: input.firstName,
      lastName: input.lastName,
    });
    // The invited person holds their role from creation, scoped to the school.
    await this.store.insertMembership({
      id: newId(),
      userId: user.id,
      schoolId,
      role,
      campusId: null,
      classId: null,
    });

    const invite: Invite = {
      id: newId(),
      schoolId,
      role,
      token: newToken(),
      userId: user.id,
      status: "pending",
      createdAt: now,
    };
    await this.store.insertInvite(invite);

    // Deliver the invite THROUGH the notification service.
    const message = await this.notifications.send({
      type: notificationType,
      to: input.email.trim(),
      subject: `You're invited to ${school.settings ? school.name : "Pathfinder"}`,
      body:
        `Hello ${input.firstName}, you've been invited to Pathfinder as a ${role}. ` +
        `Use your invite link to set a password and sign in.`,
      context: { inviteId: invite.id, schoolId, role, token: invite.token },
    });

    // The audit log records the FACT (ids only) — never the email address (PII).
    this.audit.append({
      action: `invite.${role}.created`,
      actorId,
      subjectType: "invite",
      subjectId: invite.id,
      metadata: { schoolId, userId: user.id, role, notificationId: message.id },
    });

    return { invite, user, notificationId: message.id };
  }
}
