import { describe, expect, it } from "vitest";
import { SYNTHETIC_THRESHOLDS } from "../src/domain/mastery";
import { makeHarness, seedSchoolWithAdmin, setupSignedGraph } from "./helpers";

/**
 * Milestone 4 — seed synthetic student activity (engineering task, no FR IDs).
 * Tests cover the definition of done (patterns that exercise the M5 edges) and
 * the quarantine rules (which are requirements, not suggestions).
 */
describe("M4 synthetic student activity", () => {
  async function seeded() {
    const { ctx } = makeHarness();
    const { school, campus, admin } = await seedSchoolWithAdmin(ctx);
    const klass = await ctx.schools.createClass(school.id, campus.id, "8A");
    await setupSignedGraph(ctx, school.id);
    const summary = await ctx.synthetic.seedClass(school.id, klass.id, { count: 25, seed: 42 });
    return { ctx, schoolId: school.id, classId: klass.id, adminId: admin.user.id, summary };
  }

  it("seeds ~25 synthetic students, flagged synthetic at the schema level, holding no PII", async () => {
    const { ctx, schoolId, summary } = await seeded();
    expect(summary.studentIds).toHaveLength(25);

    const synthetic = await ctx.synthetic.listSyntheticStudents(schoolId);
    expect(synthetic).toHaveLength(25);
    expect(synthetic.every((s) => s.synthetic === true)).toBe(true);
    // No PII stored for synthetic students (minimisation + quarantine).
    for (const s of synthetic) expect(await ctx.store.getPersonalData(s.id)).toBeUndefined();
  });

  it("produces varied mastery across the mapped skills", async () => {
    const { ctx, schoolId } = await seeded();
    const mastery = await ctx.activityStore.listMasteryBySchool(schoolId);
    expect(mastery.length).toBeGreaterThan(25);
    const levels = new Set(mastery.map((m) => m.level));
    expect(levels.size).toBeGreaterThanOrEqual(2); // a spread, not all identical
    const skills = new Set(mastery.map((m) => m.nodeId));
    expect(skills.size).toBeGreaterThanOrEqual(3);
  });

  it("includes the M5 edge cases: small-cohort, stale-data, persistent-misconception, insufficient-data", async () => {
    const { ctx, schoolId } = await seeded();
    const mastery = await ctx.activityStore.listMasteryBySchool(schoolId);
    const t = SYNTHETIC_THRESHOLDS;

    // Small-cohort suppression: at least one skill has a tiny cohort AND one is large.
    const cohortSizes = new Map<string, number>();
    for (const m of mastery) cohortSizes.set(m.nodeId, (cohortSizes.get(m.nodeId) ?? 0) + 1);
    const sizes = [...cohortSizes.values()];
    expect(Math.min(...sizes)).toBeLessThanOrEqual(t.smallCohortMax);
    expect(Math.max(...sizes)).toBeGreaterThan(t.smallCohortMax);

    // Stale-data flag: some records older than the staleness window.
    const staleBefore = Date.now() - t.stalenessDays * 24 * 60 * 60 * 1000;
    // (compare against the seeded clock's frame via the record timestamps themselves)
    const oldest = mastery.map((m) => new Date(m.lastActivityAt).getTime()).sort((a, b) => a - b)[0]!;
    const newest = mastery.map((m) => new Date(m.lastActivityAt).getTime()).sort((a, b) => b - a)[0]!;
    expect(newest - oldest).toBeGreaterThan(t.stalenessDays * 24 * 60 * 60 * 1000);
    expect(staleBefore).toBeGreaterThan(0);

    // Insufficient-data state: some mastery below the minimum data-point count.
    expect(mastery.some((m) => m.dataPoints < t.insufficientDataMin)).toBe(true);

    // Persistent-misconception escalation: some misconception at/above the threshold.
    const misc = await ctx.activityStore.listMisconceptionsBySchool(schoolId);
    expect(misc.some((m) => m.occurrences >= t.misconceptionEscalationMin)).toBe(true);
  });

  it("quarantine — synthetic students are excluded from any real/export surface", async () => {
    const { ctx, schoolId } = await seeded();
    // No real students exist (only synthetic + the admin, who is not a student).
    expect(await ctx.synthetic.exportRealStudents(schoolId)).toHaveLength(0);
    // A real-mastery view drops everything synthetic.
    const mastery = await ctx.activityStore.listMasteryBySchool(schoolId);
    expect(ctx.synthetic.realMastery(mastery)).toHaveLength(0);
  });

  it("quarantine — synthetic students are deletable before go-live; real accounts untouched", async () => {
    const { ctx, schoolId, adminId } = await seeded();
    const deleted = await ctx.synthetic.deleteSyntheticStudents(schoolId);
    expect(deleted).toBe(25);

    expect(await ctx.synthetic.listSyntheticStudents(schoolId)).toHaveLength(0);
    expect(await ctx.activityStore.listMasteryBySchool(schoolId)).toHaveLength(0);
    expect(await ctx.activityStore.listMisconceptionsBySchool(schoolId)).toHaveLength(0);
    // The real Admin account remains.
    expect(await ctx.store.getUser(adminId)).toBeDefined();
    expect(ctx.audit.find((e) => e.action === "synthetic.deleted")).toHaveLength(1);
  });

  it("quarantine — tuning thresholds are recorded for re-validation against real data after M7", async () => {
    const { ctx } = await seeded();
    const t = ctx.synthetic.thresholds();
    expect(t.provisional).toBe(true);
    expect(t.revalidateAfterMilestone).toBe(7);
    expect(t.smallCohortMax).toBeGreaterThan(0);
  });

  it("refuses to seed without a signed-off skill graph", async () => {
    const { ctx } = makeHarness();
    const { school, campus } = await seedSchoolWithAdmin(ctx);
    const klass = await ctx.schools.createClass(school.id, campus.id, "8A");
    // No setupSignedGraph -> no skills.
    await expect(ctx.synthetic.seedClass(school.id, klass.id, { count: 5 })).rejects.toThrow(/skill graph/i);
  });
});
