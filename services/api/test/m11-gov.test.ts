import { describe, expect, it, vi } from "vitest";
import { AiServiceLayer, assertCompliantProvider } from "../src/platform/ai/aiServiceLayer";
import { LocalClassifierProvider } from "../src/ports/aiProvider";
import { newId } from "../src/platform/ids";
import {
  makeHarness, makeMappedContent, makeTeacher, seedMastery, seedSchoolWithAdmin, setupPrincipalSchool, setupSignedGraph, setupStudentSchool,
} from "./helpers";

describe("M11 FR-GOV — governance holds end-to-end", () => {
  it("FR-GOV-002 — an audit-logging failure BLOCKS the AI action (never silently unlogged)", async () => {
    const provider = new LocalClassifierProvider();
    const spy = vi.spyOn(provider, "complete");
    const throwingAudit = { append: () => { throw new Error("audit unavailable"); } } as never;
    const ai = new AiServiceLayer(provider, throwingAudit);
    await expect(ai.run({ purpose: "content.classify", prompt: "", input: {}, containsStudentData: false })).rejects.toThrow(/audit unavailable/);
    expect(spy).not.toHaveBeenCalled(); // the provider never ran — the action was blocked
  });

  it("FR-GOV-002 — a generation logs an ai.call with provenance + timestamp", async () => {
    const { ctx } = makeHarness();
    const { school } = await seedSchoolWithAdmin(ctx);
    const versionId = await setupSignedGraph(ctx, school.id);
    const nodeId = (await ctx.skillGraphStore.listNodes(versionId)).find((n) => n.type === "skill")!.id;
    const teacher = await makeTeacher(ctx, school.id, `t-${newId()}@r.edu`);
    await makeMappedContent(ctx, school.id, teacher.user.id, nodeId, { sections: 2 });
    await ctx.assessment.generate(school.id, teacher.user.id, { title: "Q", nodeId, count: 2, difficulty: "mixed" });

    const calls = ctx.audit.find((e) => e.action === "ai.call");
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]!.at).toBeTruthy();
    expect(calls[0]!.metadata).toHaveProperty("purpose");
  });

  it("FR-GOV-002/003 — retention deletes aged data and logs its OWN deletion", async () => {
    const s = await setupStudentSchool();
    // A real task + help session with an old message (before the retention window).
    const task = await s.ctx.studentWorkspace.assignTask(s.teacherId, s.schoolId, { studentId: s.studentId, type: "homework", title: "P", nodeId: s.nodeId, dueDate: "2025-01-01T00:00:00.000Z" });
    const session = { id: newId(), schoolId: s.schoolId, studentId: s.studentId, taskId: task.id, teacherId: s.teacherId, createdAt: "2025-01-01T00:00:00.000Z" };
    await s.ctx.workspaceStore.insertHelpSession(session);
    await s.ctx.workspaceStore.insertHelpMessage({ id: newId(), sessionId: session.id, role: "student", text: "old", kind: "hint", createdAt: "2025-01-01T00:00:00.000Z" });

    await s.ctx.governance.configureRetention(s.adminId, s.schoolId, 30);
    const result = await s.ctx.governance.runRetention(s.schoolId, "2026-01-01T00:00:00.000Z");
    expect(result.deleted).toBe(1);
    expect(s.ctx.audit.find((e) => e.action === "retention.deleted").length).toBe(1);
  });

  it("FR-GOV-006 — erasure removes PII, keeps audited facts, and PRESERVES the hash chain", async () => {
    const { ctx } = makeHarness();
    const { school, campus, admin } = await seedSchoolWithAdmin(ctx);
    const klass = await ctx.schools.createClass(school.id, campus.id, "8A");
    const student = { id: newId(), schoolId: school.id, status: "active" as const, synthetic: false, createdAt: ctx.clock.isoNow() };
    await ctx.store.insertUser(student);
    await ctx.store.upsertPersonalData({ userId: student.id, email: "kid@r.edu", firstName: "Kid", lastName: "Student" });
    await ctx.store.insertMembership({ id: newId(), userId: student.id, schoolId: school.id, role: "student", campusId: campus.id, classId: klass.id, department: null });
    await seedMastery(ctx, school.id, student.id, "node-x", 0.8, ctx.clock.isoNow());

    expect(ctx.audit.verifyChain()).toBe(true);
    const erase = await ctx.governance.eraseStudent(admin.user.id, school.id, student.id, { confirm: true });
    expect(erase.erased).toBe(true);

    expect(await ctx.store.getPersonalData(student.id)).toBeUndefined(); // PII gone
    expect((await ctx.activityStore.listMasteryBySchool(school.id)).length).toBe(1); // audited fact retained
    expect(ctx.audit.find((e) => e.action === "datasubject.erased").length).toBe(1);
    expect(ctx.audit.verifyChain()).toBe(true); // chain still verifiable, no PII retained
  });

  it("FR-GOV-006 — active records require an explicit confirm (PII-only erasure is the default)", async () => {
    const { ctx } = makeHarness();
    const { school, campus, admin } = await seedSchoolWithAdmin(ctx);
    const klass = await ctx.schools.createClass(school.id, campus.id, "8A");
    const student = { id: newId(), schoolId: school.id, status: "active" as const, synthetic: false, createdAt: ctx.clock.isoNow() };
    await ctx.store.insertUser(student);
    await ctx.store.upsertPersonalData({ userId: student.id, email: "kid@r.edu", firstName: "Kid", lastName: "Student" });
    await ctx.store.insertEnrolment({ id: newId(), studentId: student.id, classId: klass.id, schoolId: school.id, active: true });

    const preview = await ctx.governance.eraseStudent(admin.user.id, school.id, student.id); // no confirm
    expect(preview.erased).toBe(false);
    expect(preview.requiresConfirmation).toBe(true);
    expect(preview.affected?.activeEnrolment).toBe(true);
    expect(await ctx.store.getPersonalData(student.id)).toBeDefined(); // nothing removed yet
  });

  it("FR-GOV-006 — export produces a complete, human-readable record of the student's data", async () => {
    const p = await setupPrincipalSchool();
    const klass = await p.makeClass("8A");
    const student = await p.enrol(klass.id, "Ada");
    await seedMastery(p.ctx, p.schoolId, student, p.nodeId, 0.7, "2025-12-20T00:00:00.000Z");

    const exported = await p.ctx.governance.exportStudent(p.adminId, p.schoolId, student);
    expect((exported.personalData as { firstName?: string }).firstName).toBe("Ada");
    expect(Array.isArray(exported.mastery)).toBe(true);
  });

  it("FR-GOV-004/007 — the AI guard blocks training-enabled and offshore endpoints", async () => {
    expect(() => assertCompliantProvider({ kind: "remote", provider: "x", region: "ap-southeast-2", zeroRetention: true, noTraining: false })).toThrow(/no-training/i);
    expect(() => assertCompliantProvider({ kind: "remote", provider: "x", region: "us-east-1", zeroRetention: true, noTraining: true })).toThrow(/offshore|region/i);
  });

  it("FR-GOV-007 — provider drift fails safe: the choke point pauses and blocks calls", async () => {
    const ai = new AiServiceLayer(new LocalClassifierProvider(), null);
    ai.pauseForDrift("provider data-handling config could not be verified");
    expect(ai.isPaused()).toBe(true);
    await expect(ai.run({ purpose: "content.classify", prompt: "", input: {}, containsStudentData: false })).rejects.toMatchObject({ code: "AI_PAUSED" });
    ai.resume();
    await expect(ai.run({ purpose: "content.classify", prompt: "", input: {}, containsStudentData: false })).resolves.toBeDefined();
  });

  it("NFR-COST-001 — a fair-use cap declines further AI calls rather than billing unbounded", async () => {
    const ai = new AiServiceLayer(new LocalClassifierProvider(), null);
    ai.setUsageCap(1);
    await ai.run({ purpose: "content.classify", prompt: "", input: {}, containsStudentData: false }, "teacher-1");
    await expect(ai.run({ purpose: "content.classify", prompt: "", input: {}, containsStudentData: false }, "teacher-1")).rejects.toMatchObject({ code: "COST_CAP_REACHED" });
  });

  it("FR-GOV-005 — publish records review metadata and a fast bulk approval is flagged (non-blocking)", async () => {
    const { ctx } = makeHarness();
    const { school } = await seedSchoolWithAdmin(ctx);
    const versionId = await setupSignedGraph(ctx, school.id);
    const nodeId = (await ctx.skillGraphStore.listNodes(versionId)).find((n) => n.type === "skill")!.id;
    const teacher = await makeTeacher(ctx, school.id, `t-${newId()}@r.edu`);
    await makeMappedContent(ctx, school.id, teacher.user.id, nodeId, { sections: 3 });
    const gen = await ctx.assessment.generate(school.id, teacher.user.id, { title: "Q", nodeId, count: 3, difficulty: "mixed" });
    if (gen.status !== "generated") throw new Error("gen");
    // Publish without review is blocked (each item must be opened/reviewed).
    await expect(ctx.assessment.publish(gen.assessmentId, teacher.user.id)).rejects.toThrow(/review/i);
    await ctx.assessment.acknowledgeReview(gen.assessmentId, teacher.user.id);
    await ctx.assessment.publish(gen.assessmentId, teacher.user.id);

    const pub = ctx.audit.find((e) => e.action === "assessment.published").at(-1)!;
    expect(pub.metadata).toHaveProperty("itemsOpened");
    expect(pub.metadata).toHaveProperty("reviewDurationMs");

    const prompt = await ctx.assessment.approvalQualityPrompt(teacher.user.id, { floorMsPerItem: 60_000 });
    expect(prompt.flagged).toBe(true);
    expect(prompt.prompt).toMatch(/spot-check/i);
  });
});
