import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { AuthError, ConflictError, NotFoundError, ValidationError } from "../domain/errors";
import type { Membership, User } from "../domain/types";
import type { AuditRecorder } from "../platform/audit/auditLog";
import type { Clock } from "../platform/clock";
import { newToken } from "../platform/ids";
import type { DataStore } from "../ports/dataStore";

export interface AcceptInviteResult {
  user: User;
}

export interface LoginResult {
  token: string;
  userId: string;
}

/** Live authorization result — permissions are computed on each call. */
export interface Authorization {
  user: User;
  memberships: Membership[];
  roles: string[];
}

export class AuthService {
  constructor(
    private readonly store: DataStore,
    private readonly clock: Clock,
    private readonly audit: AuditRecorder,
  ) {}

  /** Accept an invite: activate the user and set their password. */
  async acceptInvite(token: string, password: string): Promise<AcceptInviteResult> {
    const invite = await this.store.getInviteByToken(token);
    if (!invite) throw new AuthError("Invalid invite token.");
    if (invite.status !== "pending") {
      throw new ConflictError("INVITE_NOT_PENDING", "This invite is no longer pending.");
    }
    if (!password || password.length < 8) {
      throw new ValidationError("Password must be at least 8 characters.");
    }
    const user = await this.store.getUser(invite.userId);
    if (!user) throw new AuthError("Invited user no longer exists.");

    await this.setPassword(user.id, password);
    await this.store.updateUser({ ...user, status: "active" });
    await this.store.updateInvite({ ...invite, status: "accepted" });

    this.audit.append({
      action: "invite.accepted",
      actorId: user.id,
      subjectType: "invite",
      subjectId: invite.id,
      metadata: { userId: user.id, role: invite.role },
    });
    return { user: { ...user, status: "active" } };
  }

  /**
   * Set an initial password for an account that was created directly (not via an
   * invite) — e.g. the founding School Admin during onboarding. Distinct from
   * acceptInvite, which also flips an invite to "accepted".
   */
  async setInitialPassword(userId: string, password: string): Promise<void> {
    const user = await this.store.getUser(userId);
    if (!user) throw new NotFoundError("User not found.");
    if (!password || password.length < 8) {
      throw new ValidationError("Password must be at least 8 characters.");
    }
    await this.setPassword(userId, password);
    this.audit.append({
      action: "auth.password.set",
      actorId: userId,
      subjectType: "user",
      subjectId: userId,
      metadata: {},
    });
  }

  /** Authenticate by email + password and issue a session token. */
  async login(email: string, password: string): Promise<LoginResult> {
    const userId = await this.store.findUserIdByEmail(email);
    if (!userId) throw new AuthError("Invalid credentials.");
    const user = await this.store.getUser(userId);
    if (!user || user.status !== "active") throw new AuthError("Invalid credentials.");
    if (!(await this.verifyPassword(userId, password))) throw new AuthError("Invalid credentials.");

    const token = newToken(32);
    await this.store.insertSession({ token, userId, createdAt: this.clock.isoNow() });
    this.audit.append({
      action: "auth.login",
      actorId: userId,
      subjectType: "user",
      subjectId: userId,
      metadata: {},
    });
    return { token, userId };
  }

  /**
   * Resolve a session token to the user and their CURRENT memberships. Because
   * roles/classes are read live here (not baked into the token), a role or
   * class change takes effect immediately with no re-login (FR-ADM-002).
   */
  async authorize(token: string): Promise<Authorization> {
    const session = await this.store.getSession(token);
    if (!session) throw new AuthError("Invalid or expired session.");
    const user = await this.store.getUser(session.userId);
    if (!user || user.status !== "active") throw new AuthError("Account is not active.");
    const memberships = await this.store.listMembershipsByUser(user.id);
    const roles = [...new Set(memberships.map((m) => m.role))];
    return { user, memberships, roles };
  }

  private async setPassword(userId: string, password: string): Promise<void> {
    const salt = randomBytes(16).toString("hex");
    const hash = scryptSync(password, salt, 64).toString("hex");
    await this.store.setCredential({ userId, hash, salt });
  }

  private async verifyPassword(userId: string, password: string): Promise<boolean> {
    const credential = await this.store.getCredential(userId);
    if (!credential) return false;
    const candidate = scryptSync(password, credential.salt, 64);
    const stored = Buffer.from(credential.hash, "hex");
    return candidate.length === stored.length && timingSafeEqual(candidate, stored);
  }
}
