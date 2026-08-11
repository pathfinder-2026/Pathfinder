import { describe, expect, it } from "vitest";
import type { Assessment } from "../src/domain/assessment";
import { newId } from "../src/platform/ids";
import { setupPrincipalSchool } from "./helpers";

/** Milestone 9 — FR-PDB-001: teacher coverage / turnaround / AI approval & workload. */
describe("M9 FR-PDB-001 — teacher metrics", () => {
  function assessment(schoolId: string, teacherId: string, nodeId: string, status: "draft" | "published"): Assessment {
    return {
      id: newId(), schoolId, teacherId, title: "A", request: { title: "A", nodeId, count: 1, difficulty: "mixed" },
      status, generationStatus: "generated", publishedAt: status === "published" ? "2026-01-01T00:00:00.000Z" : null,
      scheduledStart: null, reviewAcknowledged: true, shortfall: null, flags: [], createdAt: "2026-01-01T00:00:00.000Z",
    };
  }
  // Insert the teacher directly with a chosen join date (createdAt is immutable, so
  // this must be set at insert time — works identically in-memory and vs Postgres).
  async function established(p: Awaited<ReturnType<typeof setupPrincipalSchool>>, joinedIso: string) {
    const id = newId();
    await p.ctx.store.insertUser({ id, schoolId: p.schoolId, status: "active", synthetic: false, createdAt: joinedIso });
    await p.ctx.store.upsertPersonalData({ userId: id, email: `t-${id}@r.edu`, firstName: "T", lastName: "Eacher" });
    await p.ctx.store.insertMembership({ id: newId(), userId: id, schoolId: p.schoolId, role: "teacher", campusId: p.campusId, classId: null, department: null });
    return id;
  }

  it("happy path — per-teacher and school-wide coverage/approval metrics are shown", async () => {
    const p = await setupPrincipalSchool();
    const t1 = await established(p, "2025-06-01T00:00:00.000Z");
    const t2 = await established(p, "2025-06-01T00:00:00.000Z");
    await p.ctx.assessmentStore.insertAssessment(assessment(p.schoolId, t1, p.nodeId, "published"));
    await p.ctx.assessmentStore.insertAssessment(assessment(p.schoolId, t1, p.nodeId2, "draft"));
    await p.ctx.assessmentStore.insertAssessment(assessment(p.schoolId, t2, p.nodeId, "published"));

    const report = await p.ctx.principalDashboard.teacherReport(p.principalId, p.schoolId);
    expect(report.teachers).toHaveLength(2);
    expect(report.schoolWide.teacherCount).toBe(2);
    const m1 = report.teachers.find((x) => x.teacherId === t1)!;
    expect(m1.assessmentsAuthored).toBe(2);
    expect(m1.aiApprovalRate).toBe(0.5); // 1 of 2 published
    expect(m1.coverage).toBe(2);
  });

  it("edge — a low-activity established teacher is flagged distinctly, not blended into the average", async () => {
    const p = await setupPrincipalSchool();
    const active = await established(p, "2025-06-01T00:00:00.000Z");
    const idle = await established(p, "2025-06-01T00:00:00.000Z");
    await p.ctx.assessmentStore.insertAssessment(assessment(p.schoolId, active, p.nodeId, "published"));
    await p.ctx.assessmentStore.insertAssessment(assessment(p.schoolId, active, p.nodeId2, "published"));
    await p.ctx.assessmentStore.insertAssessment(assessment(p.schoolId, active, p.nodeId, "published"));

    const report = await p.ctx.principalDashboard.teacherReport(p.principalId, p.schoolId);
    expect(report.teachers.find((x) => x.teacherId === idle)!.lowEngagementOutlier).toBe(true);
    expect(report.teachers.find((x) => x.teacherId === active)!.lowEngagementOutlier).toBe(false);
  });

  it("edge — a new teacher is shown in a shorter window, not unfairly flagged as low-engagement", async () => {
    const p = await setupPrincipalSchool();
    const fresh = await established(p, "2025-12-18T00:00:00.000Z"); // ~2 weeks before the 2026-01-01 clock

    const report = await p.ctx.principalDashboard.teacherReport(p.principalId, p.schoolId);
    const m = report.teachers.find((x) => x.teacherId === fresh)!;
    expect(m.newTeacher).toBe(true);
    expect(m.windowDays).toBeLessThanOrEqual(30);
    expect(m.lowEngagementOutlier).toBe(false); // contextualised, not compared unfairly
  });
});
