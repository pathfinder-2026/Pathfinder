import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import postgres, { type Sql } from "postgres";
import { buildContext, type AppContext } from "../src/context";
import { FixedClock } from "../src/platform/clock";
import { newId } from "../src/platform/ids";
import type { User } from "../src/domain/types";
import type { SkillGraphSource } from "../src/domain/skillGraph";
import { PgDataStore } from "../src/adapters/postgres/pgDataStore";
import { PgContentStore } from "../src/adapters/postgres/pgContentStore";
import { PgSkillGraphStore } from "../src/adapters/postgres/pgSkillGraphStore";
import { PgAssessmentStore } from "../src/adapters/postgres/pgAssessmentStore";
import { PgActivityStore } from "../src/adapters/postgres/pgActivityStore";
import { PgDashboardStore } from "../src/adapters/postgres/pgDashboardStore";
import { PgPeerStore } from "../src/adapters/postgres/pgPeerStore";
import { PgAgentStore } from "../src/adapters/postgres/pgAgentStore";
import { PgWorkspaceStore } from "../src/adapters/postgres/pgWorkspaceStore";
import { PgParentStore } from "../src/adapters/postgres/pgParentStore";
import { PgReportingStore } from "../src/adapters/postgres/pgReportingStore";
import { PgBrandingStore } from "../src/adapters/postgres/pgBrandingStore";

export interface TestHarness {
  ctx: AppContext;
  clock: FixedClock;
}

let sharedSql: Sql | undefined;
function getSql(): Sql {
  sharedSql ??= postgres(process.env.DATABASE_URL!, { onnotice: () => {} });
  return sharedSql;
}

/**
 * Build an app context and a deterministic clock. Backed by the in-memory store
 * by default; when PATHFINDER_TEST_BACKEND=pg, the same tests run against the
 * PostgreSQL adapters (see vitest.pg-suite.config.ts).
 */
export function makeHarness(): TestHarness {
  const clock = new FixedClock();
  if (process.env.PATHFINDER_TEST_BACKEND === "pg") {
    const sql = getSql();
    const ctx = buildContext({
      clock,
      store: new PgDataStore(sql),
      contentStore: new PgContentStore(sql),
      skillGraphStore: new PgSkillGraphStore(sql),
      assessmentStore: new PgAssessmentStore(sql),
      activityStore: new PgActivityStore(sql),
      dashboardStore: new PgDashboardStore(sql),
      peerStore: new PgPeerStore(sql),
      agentStore: new PgAgentStore(sql),
      workspaceStore: new PgWorkspaceStore(sql),
      parentStore: new PgParentStore(sql),
      reportingStore: new PgReportingStore(sql),
      brandingStore: new PgBrandingStore(sql),
    });
    return { ctx, clock };
  }
  const ctx = buildContext({ clock });
  return { ctx, clock };
}

export const VALID_YEAR = {
  name: "2026",
  terms: [
    { name: "Term 1", startDate: "2026-01-28", endDate: "2026-04-10" },
    { name: "Term 2", startDate: "2026-04-27", endDate: "2026-07-03" },
  ],
};

/** Seed a school + one Admin. Returns the created entities. */
export async function seedSchoolWithAdmin(ctx: AppContext, name = "Springfield High") {
  const created = await ctx.schools.createSchool({
    name,
    campusName: "Main Campus",
    academicYear: VALID_YEAR,
  });
  const admin = await ctx.accounts.createAccount({
    schoolId: created.school.id,
    role: "admin",
    email: `admin@${slug(name)}.edu`,
    firstName: "Ada",
    lastName: "Admin",
  });
  return { ...created, admin };
}

/** Insert a plain user (with PII) and no membership; caller adds memberships. */
export async function makeUser(ctx: AppContext, schoolId: string, email: string): Promise<User> {
  const user: User = { id: newId(), schoolId, status: "active", synthetic: false, createdAt: ctx.clock.isoNow() };
  await ctx.store.insertUser(user);
  await ctx.store.upsertPersonalData({ userId: user.id, email, firstName: "Test", lastName: "User" });
  return user;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

// ---- Milestone 2 skill-graph helpers ----

/** Read the AI-drafted NSW Y8 Maths seed graph (the committed build input). */
export function readSeedGraph(): SkillGraphSource {
  const path = fileURLToPath(
    new URL("../../../db/seeds/pathfinder_skill_graph_nsw_y8_maths_v0.1.json", import.meta.url),
  );
  return JSON.parse(readFileSync(path, "utf8")) as SkillGraphSource;
}

/** The AI-drafted NSW Y7 Science seed — a second subject, for multi-graph tests. */
export function readScienceSeedGraph(): SkillGraphSource {
  const path = fileURLToPath(
    new URL("../../../db/seeds/pathfinder_skill_graph_nsw_y7_science_v0.1.json", import.meta.url),
  );
  return JSON.parse(readFileSync(path, "utf8")) as SkillGraphSource;
}

/**
 * Import the seed graph, sign it off (simulating the curriculum expert), and
 * configure the school on NSW. Returns the signed-off graph version id.
 */
export async function setupSignedGraph(
  ctx: AppContext,
  schoolId: string,
  expertId = "expert-1",
): Promise<string> {
  const version = await ctx.skillGraph.importGraph(readSeedGraph());
  await ctx.skillGraph.signOff(version.id, expertId);
  await ctx.mapping.configureCurriculum(schoolId, "NSW");
  return version.id;
}

// ---- Milestone 1 content helpers ----

let hashCounter = 0;
/** Deterministic unique content hash for tests. */
export function testHash(seed = ""): string {
  hashCounter += 1;
  return `hash-${seed}-${hashCounter}`;
}

export function makeTeacher(
  ctx: AppContext,
  schoolId: string,
  email: string,
  opts: { classId?: string | null; department?: string | null } = {},
) {
  // Returns a Promise (createAccount is async); callers await.
  return ctx.accounts.createAccount({
    schoolId,
    role: "teacher",
    email,
    firstName: "T",
    lastName: "Eacher",
    classId: opts.classId ?? null,
    department: opts.department ?? null,
  });
}

/**
 * Upload → ingest → classify → approve classification → attest rights →
 * approve content, so the item lands in the approved pool. Returns the item id.
 */
export async function makeApprovedContent(
  ctx: AppContext,
  schoolId: string,
  teacherId: string,
  opts: { title?: string; text?: string; share?: import("../src/domain/content").ShareScope } = {},
): Promise<string> {
  const up = await ctx.content.uploadOne(schoolId, teacherId, {
    title: opts.title ?? "Year 8 Algebra worksheet",
    fileType: "pdf",
    sizeBytes: 2048,
    contentHash: testHash("approved"),
    source: { text: opts.text ?? "# Algebra\nSolve the linear equation 2x + 3 = 11." },
    share: opts.share,
  });
  if (up.status !== "accepted") throw new Error(`upload not accepted: ${up.reason}`);
  const item = (await ctx.contentStore.getContentItem(up.contentItemId))!;
  await ctx.ingestion.ingest(item.currentVersionId, teacherId);
  await ctx.classification.classify(up.contentItemId, teacherId);
  await ctx.classification.approveClassification(up.contentItemId, teacherId);
  await ctx.content.attestRights(up.contentItemId, teacherId);
  await ctx.content.approveContent(up.contentItemId, teacherId);
  return up.contentItemId;
}

// ---- Milestone 3 assessment helpers ----

/**
 * Approved content with `sections` groundable chunks, mapped to `nodeId` at a
 * given difficulty. Grounding capacity for generation == number of sections.
 */
export async function makeMappedContent(
  ctx: AppContext,
  schoolId: string,
  teacherId: string,
  nodeId: string,
  opts: { sections?: number; numeric?: boolean; difficulty?: string; title?: string } = {},
): Promise<string> {
  const n = opts.sections ?? 1;
  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    const heading = `# Topic ${String.fromCharCode(65 + i)}`; // "Topic A" — no digits
    const body = opts.numeric ? `The sum equals ${i + 2} and ${i + 5}.` : `Explain the idea clearly in prose.`;
    parts.push(`${heading}\n${body}`);
  }
  const up = await ctx.content.uploadOne(schoolId, teacherId, {
    title: opts.title ?? "Grounded content",
    fileType: "pdf",
    sizeBytes: 1000,
    contentHash: testHash("grounded"),
    source: { text: parts.join("\n") },
  });
  if (up.status !== "accepted") throw new Error("upload not accepted");
  const item = (await ctx.contentStore.getContentItem(up.contentItemId))!;
  await ctx.ingestion.ingest(item.currentVersionId, teacherId);
  await ctx.classification.classify(up.contentItemId, teacherId);
  await ctx.classification.approveClassification(up.contentItemId, teacherId);
  await ctx.content.attestRights(up.contentItemId, teacherId);
  await ctx.content.approveContent(up.contentItemId, teacherId);
  await ctx.mapping.mapContent(up.contentItemId, [nodeId], { difficulty: opts.difficulty ?? "developing" });
  return up.contentItemId;
}

// ---- Milestone 5a intelligence-layer helper ----

/**
 * Stand up a school with a signed-off graph and a class seeded with synthetic
 * activity (the M4 substrate the M5a dashboard/cohort/adaptive layers read).
 * Returns the seed summary, whose landmarks make each 5a scenario deterministic.
 */
export async function seedActivityClass(
  ctx: AppContext,
  opts: { count?: number; seed?: number } = {},
) {
  const { school, campus, admin } = await seedSchoolWithAdmin(ctx);
  const klass = await ctx.schools.createClass(school.id, campus.id, "8A");
  await setupSignedGraph(ctx, school.id);
  const summary = await ctx.synthetic.seedClass(school.id, klass.id, {
    count: opts.count ?? 25,
    seed: opts.seed ?? 42,
  });
  return { ctx, schoolId: school.id, classId: klass.id, adminId: admin.user.id, summary };
}

// ---- Milestone 5b peer-layer helper ----

/** Create `n` student users (with PII), returning their ids — a peer cohort. */
export async function makeStudents(ctx: AppContext, schoolId: string, n: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) ids.push((await makeUser(ctx, schoolId, `stud${i}-${newId()}@riverbank.edu`)).id);
  return ids;
}

/**
 * Stand up a school with a signed graph, a teacher, and approved+mapped content
 * on a skill node — the substrate a peer test grounds on. `sections` sets the
 * grounding capacity (for the insufficient-content edge).
 */
export async function setupPeerClass(opts: { students?: number; sections?: number } = {}) {
  const { ctx, clock } = makeHarness();
  // Unique name: some tests build two peer schools, which would collide on the
  // shared Postgres backend (in-memory gets a fresh store per harness).
  const { school } = await seedSchoolWithAdmin(ctx, `Peer School ${newId()}`);
  const versionId = await setupSignedGraph(ctx, school.id);
  const skillNodes = (await ctx.skillGraphStore.listNodes(versionId)).filter((n) => n.type === "skill");
  const nodeId = skillNodes[0]!.id;
  const teacher = await makeTeacher(ctx, school.id, `peer-teacher-${newId()}@riverbank.edu`);
  await makeMappedContent(ctx, school.id, teacher.user.id, nodeId, { sections: opts.sections ?? 4 });
  const students = await makeStudents(ctx, school.id, opts.students ?? 8);
  return { ctx, clock, schoolId: school.id, teacherId: teacher.user.id, nodeId, students };
}

// ---- Milestone 6 Teacher-Agent helper ----

/**
 * A school with a signed graph and a teacher, plus two skill nodes: `nodeId`
 * (map approved content to it) and `emptyNodeId` (deliberately no content, for the
 * decline path). Content mapping is left to the test.
 */
export async function setupAgentSchool() {
  const { ctx, clock } = makeHarness();
  const { school, campus } = await seedSchoolWithAdmin(ctx, `Agent School ${newId()}`);
  const versionId = await setupSignedGraph(ctx, school.id);
  const skills = (await ctx.skillGraphStore.listNodes(versionId)).filter((n) => n.type === "skill");
  const teacher = await makeTeacher(ctx, school.id, `agent-teacher-${newId()}@riverbank.edu`);
  return {
    ctx, clock, schoolId: school.id, campusId: campus.id, teacherId: teacher.user.id,
    nodeId: skills[0]!.id, emptyNodeId: skills[1]!.id,
  };
}

// ---- Milestone 7 Student Workspace / Ask-for-Help helper ----

/**
 * A school with a signed graph, a year-8 class, an assigning teacher, and a real
 * (non-synthetic) enrolled student. Safeguarding is configured by default (Ask for
 * Help's hard precondition); pass `safeguarding: false` to leave it unconfigured.
 */
export async function setupStudentSchool(opts: { safeguarding?: boolean; yearGroup?: string } = {}) {
  const { ctx, clock } = makeHarness();
  const { school, campus, admin } = await seedSchoolWithAdmin(ctx, `Student School ${newId()}`);
  const versionId = await setupSignedGraph(ctx, school.id);
  const nodeId = (await ctx.skillGraphStore.listNodes(versionId)).filter((n) => n.type === "skill")[0]!.id;
  const yearGroup = opts.yearGroup ?? "8";
  const klass = await ctx.schools.createClass(school.id, campus.id, "8A", admin.user.id, yearGroup);
  const teacher = await makeTeacher(ctx, school.id, `sw-teacher-${newId()}@r.edu`, { classId: klass.id });

  const student = await makeUser(ctx, school.id, `sw-stud-${newId()}@r.edu`);
  await ctx.store.insertMembership({
    id: newId(), userId: student.id, schoolId: school.id, role: "student", campusId: campus.id, classId: klass.id, department: null,
  });
  await ctx.store.insertEnrolment({ id: newId(), studentId: student.id, classId: klass.id, schoolId: school.id, active: true });

  if (opts.safeguarding !== false) {
    await ctx.safeguarding.setConfig(admin.user.id, school.id, {
      contactName: "Sam Safe", contactRole: "Designated Safeguarding Lead", slaHours: 24, afterHoursPolicy: "On-call DSL phone",
    });
  }
  return {
    ctx, clock, schoolId: school.id, campusId: campus.id, adminId: admin.user.id,
    teacherId: teacher.user.id, studentId: student.id, classId: klass.id, nodeId, yearGroup,
  };
}

// ---- Milestone 8 Parent Dashboard helper ----

/** Seed one mastery record for a real student (M8 parent-dashboard tests). */
export async function seedMastery(
  ctx: AppContext, schoolId: string, studentId: string, nodeId: string, score: number, whenIso: string,
): Promise<void> {
  await ctx.activityStore.insertMastery({
    id: newId(), studentId, schoolId, nodeId, level: score >= 0.67 ? "secure" : score >= 0.34 ? "developing" : "low",
    score, dataPoints: 5, lastActivityAt: whenIso, synthetic: false,
  });
}

/** A student enrolled in a class (with PII), returning the user id. Exported for M9. */
export async function enrolStudent(ctx: AppContext, schoolId: string, campusId: string, classId: string, firstName: string): Promise<string> {
  return makeEnrolledStudent(ctx, schoolId, campusId, classId, firstName);
}

/** A student enrolled in a class (with PII), returning the user id. */
async function makeEnrolledStudent(ctx: AppContext, schoolId: string, campusId: string, classId: string, firstName: string): Promise<string> {
  const user = await makeUser(ctx, schoolId, `par-stud-${newId()}@r.edu`);
  await ctx.store.upsertPersonalData({ userId: user.id, email: `par-stud-${newId()}@r.edu`, firstName, lastName: "Student" });
  await ctx.store.insertMembership({ id: newId(), userId: user.id, schoolId, role: "student", campusId, classId, department: null });
  await ctx.store.insertEnrolment({ id: newId(), studentId: user.id, classId, schoolId, active: true });
  return user.id;
}

/**
 * A school with a signed graph, a year-8 class, an enrolled child, and a parent
 * user (not yet linked). Exposes skill nodes so tests can seed mastery. Use
 * `ctx.parents.linkChild` + `verifyLink` to establish the verified relationship.
 */
export async function setupParentSchool() {
  const { ctx, clock } = makeHarness();
  const { school, campus, admin } = await seedSchoolWithAdmin(ctx, `Parent School ${newId()}`);
  const versionId = await setupSignedGraph(ctx, school.id);
  const skillNodes = (await ctx.skillGraphStore.listNodes(versionId)).filter((n) => n.type === "skill");
  const fractionsNode = skillNodes.find((n) => /fraction/i.test(n.label)) ?? skillNodes[0]!;
  const integersNode = skillNodes.find((n) => /integer/i.test(n.label)) ?? skillNodes[1]!;
  const klass = await ctx.schools.createClass(school.id, campus.id, "8A", admin.user.id, "8");
  const teacher = await makeTeacher(ctx, school.id, `par-teacher-${newId()}@r.edu`, { classId: klass.id });
  const studentId = await makeEnrolledStudent(ctx, school.id, campus.id, klass.id, "Ada");
  const parent = await makeUser(ctx, school.id, `parent-${newId()}@r.edu`);

  return {
    ctx, clock, schoolId: school.id, campusId: campus.id, adminId: admin.user.id,
    teacherId: teacher.user.id, studentId, parentId: parent.id, classId: klass.id,
    fractionsNode, integersNode, makeChild: (firstName: string) => makeEnrolledStudent(ctx, school.id, campus.id, klass.id, firstName),
  };
}

// ---- Milestone 9 Principal Dashboard helper ----

/**
 * A school with a signed graph, a Principal (assigned to the campus), and helpers
 * to create classes/teachers/students. Exposes two skill nodes for assessments.
 */
export async function setupPrincipalSchool() {
  const { ctx, clock } = makeHarness();
  const { school, campus, admin } = await seedSchoolWithAdmin(ctx, `Principal School ${newId()}`);
  const versionId = await setupSignedGraph(ctx, school.id);
  const skills = (await ctx.skillGraphStore.listNodes(versionId)).filter((n) => n.type === "skill");
  const principal = await makeUser(ctx, school.id, `principal-${newId()}@r.edu`);
  await ctx.store.insertMembership({ id: newId(), userId: principal.id, schoolId: school.id, role: "principal", campusId: campus.id, classId: null, department: null });

  return {
    ctx, clock, schoolId: school.id, campusId: campus.id, adminId: admin.user.id, principalId: principal.id,
    nodeId: skills[0]!.id, nodeId2: skills[1]!.id,
    makeClass: (name: string, yearGroup: string | null = "8") => ctx.schools.createClass(school.id, campus.id, name, admin.user.id, yearGroup),
    enrol: (classId: string, firstName: string) => enrolStudent(ctx, school.id, campus.id, classId, firstName),
    makeTeacher: (classId?: string) => makeTeacher(ctx, school.id, `p-teacher-${newId()}@r.edu`, { classId: classId ?? null }),
  };
}
