/**
 * Core domain entities for Milestone 0.
 *
 * Data-model notes (Foundational Decision 6 — minimisation & erasability):
 * personally identifying information (PII) is deliberately NOT stored on the
 * long-lived structural entities (User, Membership, Enrolment). It lives only
 * in `PersonalData`, keyed by userId, so a data-subject erasure removes the
 * person (delete the PersonalData row) while the structural id and the
 * append-only audited facts about them are retained. Every PII field below is
 * justified in docs/foundational-decisions.md.
 */

export type Role = "admin" | "teacher" | "student" | "parent" | "principal";

export type GovernanceStatus = "draft" | "approved" | "published";

/** Approvable state for AI claims about a student (Foundational Decision 7). */
export type InferenceApprovalState = "unreviewed" | "approved" | "rejected";

export interface School {
  id: string;
  name: string;
  /** Global settings inherited by campuses unless a campus overrides them. */
  settings: SchoolSettings;
  /** True once the Admin has finished the school-configuration steps. */
  configComplete: boolean;
  createdAt: string;
}

export interface SchoolSettings {
  timezone: string;
  /** Curriculum default for the thin vertical slice (NSW per plan). */
  defaultCurriculum: string;
}

export interface Campus {
  id: string;
  schoolId: string;
  name: string;
  /** Effective settings; seeded by inheritance from the school. */
  settings: SchoolSettings;
  /** False while the campus is still being set up (no valid academic year). */
  setupComplete: boolean;
  createdAt: string;
}

export interface AcademicYear {
  id: string;
  schoolId: string;
  /** null => a school-global year; set => a campus-specific year. */
  campusId: string | null;
  name: string;
}

export interface Term {
  id: string;
  academicYearId: string;
  name: string;
  startDate: string; // ISO date
  endDate: string; // ISO date
}

export interface ClassRoom {
  id: string;
  schoolId: string;
  campusId: string;
  name: string;
  createdAt: string;
}

export type UserStatus = "invited" | "active" | "erased";

/** Structural, PII-free user record. */
export interface User {
  id: string;
  schoolId: string;
  status: UserStatus;
  createdAt: string;
}

/** Erasable PII, kept separate from the structural User (Decision 6). */
export interface PersonalData {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
}

/** A role granted to a user, optionally scoped to a campus and/or class. */
export interface Membership {
  id: string;
  userId: string;
  schoolId: string;
  role: Role;
  campusId: string | null;
  classId: string | null;
  /** Optional department (used for department-scoped content sharing, M1). */
  department?: string | null;
}

export type InviteStatus = "pending" | "accepted" | "revoked";

export interface Invite {
  id: string;
  schoolId: string;
  role: Role;
  /** Opaque acceptance token (not PII; the email lives in PersonalData). */
  token: string;
  userId: string;
  status: InviteStatus;
  createdAt: string;
}

/** Active class enrolment for a student. */
export interface Enrolment {
  id: string;
  studentId: string;
  classId: string;
  schoolId: string;
  active: boolean;
}

/**
 * A closed (historical) enrolment, retained so the original class Teacher can
 * still see a transferred student's history (FR-ADM-002 edge case).
 */
export interface EnrolmentHistory {
  id: string;
  studentId: string;
  classId: string;
  /** Teacher who taught the class at the time (visibility target). */
  teacherId: string | null;
  endedAt: string;
}

/**
 * An AI-generated claim about a student (mastery/misconception/etc.). No rows
 * are produced in Milestone 0; the table/entity exists from the first schema
 * so the approval gate (Decision 7) can be switched on later WITHOUT a schema
 * migration. `approvalState` defaults to "unreviewed".
 */
export interface InferenceRecord {
  id: string;
  studentId: string;
  schoolId: string;
  kind: "mastery" | "misconception" | "other";
  claim: string;
  approvalState: InferenceApprovalState;
  createdAt: string;
}
