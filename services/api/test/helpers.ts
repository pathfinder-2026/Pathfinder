import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildContext, type AppContext } from "../src/context";
import { FixedClock } from "../src/platform/clock";
import { newId } from "../src/platform/ids";
import type { User } from "../src/domain/types";
import type { SkillGraphSource } from "../src/domain/skillGraph";

export interface TestHarness {
  ctx: AppContext;
  clock: FixedClock;
}

/** Build an app context backed by the in-memory store and a deterministic clock. */
export function makeHarness(): TestHarness {
  const clock = new FixedClock();
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
export function seedSchoolWithAdmin(ctx: AppContext, name = "Springfield High") {
  const created = ctx.schools.createSchool({
    name,
    campusName: "Main Campus",
    academicYear: VALID_YEAR,
  });
  const admin = ctx.accounts.createAccount({
    schoolId: created.school.id,
    role: "admin",
    email: `admin@${slug(name)}.edu`,
    firstName: "Ada",
    lastName: "Admin",
  });
  return { ...created, admin };
}

/** Insert a plain user (with PII) and no membership; caller adds memberships. */
export function makeUser(ctx: AppContext, schoolId: string, email: string): User {
  const user: User = { id: newId(), schoolId, status: "active", createdAt: ctx.clock.isoNow() };
  ctx.store.insertUser(user);
  ctx.store.upsertPersonalData({ userId: user.id, email, firstName: "Test", lastName: "User" });
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
export function setupSignedGraph(
  ctx: AppContext,
  schoolId: string,
  expertId = "expert-1",
): string {
  const version = ctx.skillGraph.importGraph(readSeedGraph());
  ctx.skillGraph.signOff(version.id, expertId);
  ctx.mapping.configureCurriculum(schoolId, "NSW");
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
  const up = ctx.content.uploadOne(schoolId, teacherId, {
    title: opts.title ?? "Year 8 Algebra worksheet",
    fileType: "pdf",
    sizeBytes: 2048,
    contentHash: testHash("approved"),
    source: { text: opts.text ?? "# Algebra\nSolve the linear equation 2x + 3 = 11." },
    share: opts.share,
  });
  if (up.status !== "accepted") throw new Error(`upload not accepted: ${up.reason}`);
  const item = ctx.contentStore.getContentItem(up.contentItemId)!;
  ctx.ingestion.ingest(item.currentVersionId, teacherId);
  await ctx.classification.classify(up.contentItemId, teacherId);
  ctx.classification.approveClassification(up.contentItemId, teacherId);
  ctx.content.attestRights(up.contentItemId, teacherId);
  ctx.content.approveContent(up.contentItemId, teacherId);
  return up.contentItemId;
}
