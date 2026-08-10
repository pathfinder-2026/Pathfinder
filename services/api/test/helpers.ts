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
