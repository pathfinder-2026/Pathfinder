import {
  boolean,
  date,
  index,
  jsonb,
  pgTable,
  primaryKey,
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
    department: text("department"),
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

// ---- Milestone 1: Content Studio + Knowledge Engine ----

export const contentItems = pgTable(
  "content_items",
  {
    id: text("id").primaryKey(),
    schoolId: text("school_id").notNull().references(() => schools.id),
    ownerTeacherId: text("owner_teacher_id").notNull().references(() => users.id),
    title: text("title").notNull(),
    currentVersionId: text("current_version_id").notNull(),
    // Governance (draft/approved/published) — the load-bearing approval gate.
    governanceStatus: text("governance_status").notNull().default("draft"),
    approvedBy: text("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    rightsAttested: boolean("rights_attested").notNull().default(false),
    archived: boolean("archived").notNull().default(false),
    shareType: text("share_type").notNull().default("private"),
    shareClassId: text("share_class_id").references(() => classes.id),
    shareDepartment: text("share_department"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => ({ bySchool: index("content_items_school_idx").on(t.schoolId) }),
);

export const contentVersions = pgTable(
  "content_versions",
  {
    id: text("id").primaryKey(),
    contentItemId: text("content_item_id").notNull().references(() => contentItems.id),
    versionNumber: bigint("version_number", { mode: "number" }).notNull(),
    fileType: text("file_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    contentHash: text("content_hash").notNull(),
    storageKey: text("storage_key").notNull(),
    uploadedByTeacherId: text("uploaded_by_teacher_id").notNull().references(() => users.id),
    scanStatus: text("scan_status").notNull(),
    ingestionStatus: text("ingestion_status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => ({ byItem: index("content_versions_item_idx").on(t.contentItemId) }),
);

export const classifications = pgTable("classifications", {
  id: text("id").primaryKey(),
  contentItemId: text("content_item_id").notNull().references(() => contentItems.id),
  subject: text("subject").notNull(),
  year: bigint("year", { mode: "number" }).notNull(),
  topic: text("topic").notNull(),
  outcome: text("outcome").notNull(),
  difficulty: text("difficulty").notNull(),
  confidence: text("confidence").notNull(),
  lowConfidence: boolean("low_confidence").notNull(),
  status: text("status").notNull(),
  reviewedByTeacherId: text("reviewed_by_teacher_id").references(() => users.id),
});

export const chunks = pgTable(
  "chunks",
  {
    id: text("id").primaryKey(),
    contentVersionId: text("content_version_id").notNull().references(() => contentVersions.id),
    heading: text("heading").notNull(),
    text: text("text").notNull(),
    order: bigint("order", { mode: "number" }).notNull(),
  },
  (t) => ({ byVersion: index("chunks_version_idx").on(t.contentVersionId) }),
);

export const concepts = pgTable(
  "concepts",
  {
    id: text("id").primaryKey(),
    contentVersionId: text("content_version_id").notNull().references(() => contentVersions.id),
    name: text("name").notNull(),
  },
  (t) => ({ byVersion: index("concepts_version_idx").on(t.contentVersionId) }),
);

export const outcomes = pgTable("outcomes", {
  id: text("id").primaryKey(),
  schoolId: text("school_id").notNull().references(() => schools.id),
  code: text("code").notNull(),
  description: text("description").notNull(),
  deprecated: boolean("deprecated").notNull().default(false),
});

export const questions = pgTable("questions", {
  id: text("id").primaryKey(),
  schoolId: text("school_id").notNull().references(() => schools.id),
  text: text("text").notNull(),
  outcomeIds: jsonb("outcome_ids").notNull(),
});

export const lessons = pgTable("lessons", {
  id: text("id").primaryKey(),
  schoolId: text("school_id").notNull().references(() => schools.id),
  title: text("title").notNull(),
  questionIds: jsonb("question_ids").notNull(),
  outcomeIds: jsonb("outcome_ids").notNull(),
});

export const contentReferences = pgTable(
  "content_references",
  {
    id: text("id").primaryKey(),
    contentItemId: text("content_item_id").notNull().references(() => contentItems.id),
    refType: text("ref_type").notNull(),
    refId: text("ref_id").notNull(),
    active: boolean("active").notNull(),
  },
  (t) => ({ byItem: index("content_references_item_idx").on(t.contentItemId) }),
);

// ---- Milestone 2: Skill Graph (versioned trusted infrastructure) ----

export const skillGraphVersions = pgTable("skill_graph_versions", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  curriculum: text("curriculum").notNull(),
  version: text("version").notNull(),
  // Governance sign-off state — draft until a curriculum expert signs off.
  status: text("status").notNull().default("draft"),
  signedOffBy: text("signed_off_by"),
  signedOffAt: timestamp("signed_off_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const skillNodes = pgTable(
  "skill_nodes",
  {
    graphVersionId: text("graph_version_id").notNull().references(() => skillGraphVersions.id),
    id: text("id").notNull(),
    type: text("type").notNull(), // subject|strand|outcome|topic|concept|skill|subskill — never 'difficulty'
    label: text("label").notNull(),
    code: text("code"),
    parentId: text("parent_id"),
    curriculum: text("curriculum").notNull(),
    foundational: boolean("foundational").notNull().default(false),
  },
  (t) => ({ pk: primaryKey({ columns: [t.graphVersionId, t.id] }) }),
);

export const skillPrerequisites = pgTable(
  "skill_prerequisites",
  {
    graphVersionId: text("graph_version_id").notNull().references(() => skillGraphVersions.id),
    fromNode: text("from_node").notNull(),
    toNode: text("to_node").notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.graphVersionId, t.fromNode, t.toNode] }) }),
);

export const contentMappings = pgTable(
  "content_mappings",
  {
    id: text("id").primaryKey(),
    graphVersionId: text("graph_version_id").notNull().references(() => skillGraphVersions.id),
    contentItemId: text("content_item_id").notNull().references(() => contentItems.id),
    nodeId: text("node_id").notNull(),
    source: text("source").notNull(), // 'ai' | 'teacher'
    difficulty: text("difficulty").notNull(), // item attribute, never a node
    overriddenFromNodeId: text("overridden_from_node_id"),
    flags: jsonb("flags").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => ({ byContent: index("content_mappings_content_idx").on(t.contentItemId) }),
);

export const schoolCurricula = pgTable("school_curricula", {
  schoolId: text("school_id").primaryKey().references(() => schools.id),
  curriculum: text("curriculum").notNull(),
  customOutcomesDefined: boolean("custom_outcomes_defined").notNull().default(true),
});

export const skillMasteryRefs = pgTable(
  "skill_mastery_refs",
  {
    contentItemId: text("content_item_id").notNull(),
    nodeId: text("node_id").notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.contentItemId, t.nodeId] }) }),
);

// ---- Milestone 3: Assessment Builder ----

export const assessments = pgTable(
  "assessments",
  {
    id: text("id").primaryKey(),
    schoolId: text("school_id").notNull().references(() => schools.id),
    teacherId: text("teacher_id").notNull().references(() => users.id),
    title: text("title").notNull(),
    request: jsonb("request").notNull(),
    status: text("status").notNull().default("draft"),
    generationStatus: text("generation_status").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    scheduledStart: timestamp("scheduled_start", { withTimezone: true }),
    reviewAcknowledged: boolean("review_acknowledged").notNull().default(false),
    shortfall: jsonb("shortfall"),
    flags: jsonb("flags").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => ({ byTeacher: index("assessments_teacher_idx").on(t.teacherId) }),
);

export const assessmentVersions = pgTable(
  "assessment_versions",
  {
    id: text("id").primaryKey(),
    assessmentId: text("assessment_id").notNull().references(() => assessments.id),
    label: text("label").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => ({ byAssessment: index("assessment_versions_assessment_idx").on(t.assessmentId) }),
);

export const assessmentQuestions = pgTable(
  "assessment_questions",
  {
    id: text("id").primaryKey(),
    versionId: text("version_id").notNull().references(() => assessmentVersions.id),
    order: bigint("order", { mode: "number" }).notNull(),
    type: text("type").notNull(),
    prompt: text("prompt").notNull(),
    options: jsonb("options"),
    modelAnswer: text("model_answer"),
    rubric: text("rubric"),
    difficulty: text("difficulty").notNull(),
    groundingContentIds: jsonb("grounding_content_ids").notNull(),
    reviewed: boolean("reviewed").notNull().default(false),
  },
  (t) => ({ byVersion: index("assessment_questions_version_idx").on(t.versionId) }),
);

export const assessmentAttempts = pgTable(
  "assessment_attempts",
  {
    id: text("id").primaryKey(),
    assessmentId: text("assessment_id").notNull().references(() => assessments.id),
    studentId: text("student_id").notNull().references(() => users.id),
    status: text("status").notNull(),
    savedAnswers: jsonb("saved_answers").notNull(),
    lastSavedAt: timestamp("last_saved_at", { withTimezone: true }).notNull(),
    interrupted: boolean("interrupted").notNull().default(false),
    resumeDeadline: timestamp("resume_deadline", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (t) => ({ byAssessment: index("assessment_attempts_assessment_idx").on(t.assessmentId) }),
);
