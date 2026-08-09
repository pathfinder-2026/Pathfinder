import {
  boolean,
  date,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  bigint,
} from "drizzle-orm/pg-core";

/**
 * Production PostgreSQL schema of record (Amazon RDS/Aurora, ap-southeast-2 —
 * Foundational Decision 1). This mirrors the domain types; the hand-written SQL
 * migrations in db/migrations own the append-only audit grants + hash-chain
 * trigger that Drizzle does not express.
 *
 * Data minimisation (Decision 6): PII lives ONLY in `personal_data`, so a
 * data-subject erasure deletes that row while `users`, `memberships` and the
 * `audit_log` (the retained facts) remain.
 */

export const schools = pgTable("schools", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  settings: jsonb("settings").notNull(),
  configComplete: boolean("config_complete").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const campuses = pgTable("campuses", {
  id: text("id").primaryKey(),
  schoolId: text("school_id").notNull().references(() => schools.id),
  name: text("name").notNull(),
  settings: jsonb("settings").notNull(),
  setupComplete: boolean("setup_complete").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const academicYears = pgTable("academic_years", {
  id: text("id").primaryKey(),
  schoolId: text("school_id").notNull().references(() => schools.id),
  campusId: text("campus_id").references(() => campuses.id),
  name: text("name").notNull(),
});

export const terms = pgTable("terms", {
  id: text("id").primaryKey(),
  academicYearId: text("academic_year_id").notNull().references(() => academicYears.id),
  name: text("name").notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
});

export const classes = pgTable("classes", {
  id: text("id").primaryKey(),
  schoolId: text("school_id").notNull().references(() => schools.id),
  campusId: text("campus_id").notNull().references(() => campuses.id),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  schoolId: text("school_id").notNull().references(() => schools.id),
  status: text("status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

/** Isolated, erasable PII (Decision 6). */
export const personalData = pgTable(
  "personal_data",
  {
    userId: text("user_id").primaryKey().references(() => users.id),
    email: text("email").notNull(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
  },
  (t) => ({ emailIdx: uniqueIndex("personal_data_email_idx").on(t.email) }),
);

export const memberships = pgTable(
  "memberships",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    schoolId: text("school_id").notNull().references(() => schools.id),
    role: text("role").notNull(),
    campusId: text("campus_id").references(() => campuses.id),
    classId: text("class_id").references(() => classes.id),
  },
  (t) => ({
    byUser: index("memberships_user_idx").on(t.userId),
    bySchool: index("memberships_school_idx").on(t.schoolId),
  }),
);

export const invites = pgTable(
  "invites",
  {
    id: text("id").primaryKey(),
    schoolId: text("school_id").notNull().references(() => schools.id),
    role: text("role").notNull(),
    token: text("token").notNull(),
    userId: text("user_id").notNull().references(() => users.id),
    status: text("status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => ({ tokenIdx: uniqueIndex("invites_token_idx").on(t.token) }),
);

export const enrolments = pgTable("enrolments", {
  id: text("id").primaryKey(),
  studentId: text("student_id").notNull().references(() => users.id),
  classId: text("class_id").notNull().references(() => classes.id),
  schoolId: text("school_id").notNull().references(() => schools.id),
  active: boolean("active").notNull(),
});

export const enrolmentHistory = pgTable("enrolment_history", {
  id: text("id").primaryKey(),
  studentId: text("student_id").notNull().references(() => users.id),
  classId: text("class_id").notNull().references(() => classes.id),
  teacherId: text("teacher_id").references(() => users.id),
  endedAt: timestamp("ended_at", { withTimezone: true }).notNull(),
});

/**
 * AI claims about a student. Empty in Milestone 0. `approval_state` exists from
 * the first schema (Decision 7) so the review gate can be switched on later
 * WITHOUT a migration. Defaults to "unreviewed".
 */
export const inferenceRecords = pgTable("inference_records", {
  id: text("id").primaryKey(),
  studentId: text("student_id").notNull().references(() => users.id),
  schoolId: text("school_id").notNull().references(() => schools.id),
  kind: text("kind").notNull(),
  claim: text("claim").notNull(),
  approvalState: text("approval_state").notNull().default("unreviewed"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

/**
 * Append-only, hash-chained audit log (Decision 3). The app role is granted
 * INSERT + SELECT only (see 0002_audit_log_grants.sql); no UPDATE/DELETE.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    seq: bigint("seq", { mode: "number" }).notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
    action: text("action").notNull(),
    actorId: text("actor_id"),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    metadata: jsonb("metadata").notNull(),
    prevHash: text("prev_hash").notNull(),
    rowHash: text("row_hash").notNull(),
  },
  (t) => ({ seqIdx: uniqueIndex("audit_log_seq_idx").on(t.seq) }),
);

export const notifications = pgTable("notifications", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  toTarget: text("to_target").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  context: jsonb("context").notNull(),
  at: timestamp("at", { withTimezone: true }).notNull(),
});

export const credentials = pgTable("credentials", {
  userId: text("user_id").primaryKey().references(() => users.id),
  hash: text("hash").notNull(),
  salt: text("salt").notNull(),
});

export const sessions = pgTable("sessions", {
  token: text("token").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const onboardingProgress = pgTable("onboarding_progress", {
  schoolId: text("school_id").primaryKey().references(() => schools.id),
  completedSteps: jsonb("completed_steps").notNull(),
  workspaceEntered: boolean("workspace_entered").notNull().default(false),
});
