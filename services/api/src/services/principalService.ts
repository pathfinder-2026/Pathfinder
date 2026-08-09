import { NotFoundError, ValidationError } from "../domain/errors";
import type { Membership } from "../domain/types";
import type { AuditRecorder } from "../platform/audit/auditLog";
import { newId } from "../platform/ids";
import type { DataStore } from "../ports/dataStore";

export interface PrincipalCampusScope {
  campusId: string;
  /** "ready" or "campus setup incomplete" (drives the dashboard message). */
  status: "ready" | "campus setup incomplete";
}

export interface PrincipalScope {
  userId: string;
  schoolId: string;
  campuses: PrincipalCampusScope[];
}

/** FR-ADM-007 — assign the Principal role to one or more campuses. */
export class PrincipalService {
  constructor(
    private readonly store: DataStore,
    private readonly audit: AuditRecorder,
  ) {}

  /** Assign a user as Principal of one or more campuses within one school. */
  assignPrincipal(
    userId: string,
    campusIds: string[],
    actorId: string | null = null,
  ): Membership[] {
    if (campusIds.length === 0) throw new ValidationError("At least one campus is required.");

    const campuses = campusIds.map((id) => {
      const campus = this.store.getCampus(id);
      if (!campus) throw new NotFoundError(`Campus ${id} not found.`);
      return campus;
    });
    const schoolIds = new Set(campuses.map((c) => c.schoolId));
    if (schoolIds.size > 1) {
      throw new ValidationError("A Principal assignment must stay within a single school.");
    }

    const existing = this.store
      .listMembershipsByUser(userId)
      .filter((m) => m.role === "principal");

    const created: Membership[] = [];
    for (const campus of campuses) {
      if (existing.some((m) => m.campusId === campus.id)) continue; // idempotent
      const membership: Membership = {
        id: newId(),
        userId,
        schoolId: campus.schoolId,
        role: "principal",
        campusId: campus.id,
        classId: null,
      };
      this.store.insertMembership(membership);
      created.push(membership);
      this.audit.append({
        action: "principal.assigned",
        actorId,
        subjectType: "user",
        subjectId: userId,
        // A campus still being set up may still be assigned a Principal.
        metadata: { campusId: campus.id, setupComplete: campus.setupComplete },
      });
    }
    return created;
  }

  /**
   * Reassign a Principal from one campus to another. Access to the previous
   * campus is revoked immediately (its membership is deleted).
   */
  reassignPrincipal(
    userId: string,
    fromCampusId: string,
    toCampusId: string,
    actorId: string | null = null,
  ): Membership[] {
    const toRemove = this.store
      .listMembershipsByUser(userId)
      .filter((m) => m.role === "principal" && m.campusId === fromCampusId);
    if (toRemove.length === 0) {
      throw new NotFoundError("Principal is not assigned to the source campus.");
    }
    for (const m of toRemove) this.store.deleteMembership(m.id);
    this.audit.append({
      action: "principal.revoked",
      actorId,
      subjectType: "user",
      subjectId: userId,
      metadata: { campusId: fromCampusId },
    });
    return this.assignPrincipal(userId, [toCampusId], actorId);
  }

  /**
   * The Principal's aggregated scope across the campuses they oversee, within
   * this single school. Campuses still being set up are flagged.
   */
  getPrincipalScope(userId: string): PrincipalScope {
    const memberships = this.store
      .listMembershipsByUser(userId)
      .filter((m) => m.role === "principal");
    if (memberships.length === 0) {
      throw new NotFoundError("User is not a Principal of any campus.");
    }
    const schoolId = memberships[0]!.schoolId;
    const campuses: PrincipalCampusScope[] = memberships
      .filter((m) => m.campusId)
      .map((m) => {
        const campus = this.store.getCampus(m.campusId!);
        return {
          campusId: m.campusId!,
          status: campus?.setupComplete ? "ready" : "campus setup incomplete",
        };
      });
    return { userId, schoolId, campuses };
  }
}
