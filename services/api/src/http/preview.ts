import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context";
import type { SkillGraphSource, SkillNode } from "../domain/skillGraph";
import type { SeedSummary } from "../services/syntheticService";
import { GOVERNANCE_TOKENS, DEFAULT_BRAND_TOKENS } from "../platform/designSystem/tokens";

/**
 * Preview / validation console API (labelled, NOT the production design-system UI).
 *
 * Exposes the already-tested M0–M5a services over HTTP so the Teacher-facing
 * intelligence and the governance moments (approve, sign-off, publish, dismiss,
 * assign) can be seen and clicked in a browser. On first call it bootstraps ONE
 * in-memory demo school with a signed graph, approved+mapped content, a published
 * assessment and the M4 synthetic class — so every screen has real data.
 *
 * Nothing here is a new feature: it renders validated milestones. Synthetic
 * students hold no PII, so the UI shows positional labels ("Student 03"), never
 * personal data.
 */

interface DemoWorld {
  schoolId: string;
  campusId: string;
  classId: string;
  emptyClassId: string;
  adminId: string;
  teacherId: string;
  versionId: string;
  summary: SeedSummary;
  studentLabel: Map<string, string>;
  studentRole: Map<string, string[]>;
  nodeLabel: Map<string, string>;
  contentTitle: Map<string, string>;
}

let building: Promise<DemoWorld> | undefined;

function loadSeedGraph(): SkillGraphSource {
  const path = fileURLToPath(
    new URL("../../../../db/seeds/pathfinder_skill_graph_nsw_y8_maths_v0.1.json", import.meta.url),
  );
  return JSON.parse(readFileSync(path, "utf8")) as SkillGraphSource;
}

async function bootstrap(ctx: AppContext): Promise<DemoWorld> {
  let hashSeq = 0;
  const contentTitle = new Map<string, string>();

  // ---- M0: school, campus, year, classes, admin + teacher ----
  const created = await ctx.schools.createSchool({
    name: "Riverbank Secondary College",
    campusName: "Main Campus",
    academicYear: {
      name: "2026",
      terms: [
        { name: "Term 1", startDate: "2026-01-28", endDate: "2026-04-10" },
        { name: "Term 2", startDate: "2026-04-27", endDate: "2026-07-03" },
      ],
    },
  });
  const schoolId = created.school.id;
  const campusId = created.campus.id;

  const klass = await ctx.schools.createClass(schoolId, campusId, "Year 8 Maths — 8A");
  const emptyClass = await ctx.schools.createClass(schoolId, campusId, "Year 8 Maths — 8B (new)");

  const admin = await ctx.accounts.createAccount({
    schoolId, role: "admin", email: "ada.admin@riverbank.edu", firstName: "Ada", lastName: "Admin",
  });
  const teacher = await ctx.accounts.createAccount({
    schoolId, role: "teacher", email: "tom.teacher@riverbank.edu", firstName: "Tom", lastName: "Teacher",
    classId: klass.id,
  });
  const teacherId = teacher.user.id;

  // ---- M2: import the AI-drafted graph, sign it off, put the school on NSW ----
  const version = await ctx.skillGraph.importGraph(loadSeedGraph());
  await ctx.skillGraph.signOff(version.id, admin.user.id);
  await ctx.mapping.configureCurriculum(schoolId, "NSW");

  const nodes = await ctx.skillGraphStore.listNodes(version.id);
  const nodeLabel = new Map<string, string>(nodes.map((n: SkillNode) => [n.id, n.label]));

  // ---- M4: seed the synthetic class (returns the M5a landmarks) ----
  const summary = await ctx.synthetic.seedClass(schoolId, klass.id, { count: 25, seed: 42 });

  const studentLabel = new Map<string, string>();
  summary.studentIds.forEach((id, i) => studentLabel.set(id, `Student ${String(i + 1).padStart(2, "0")}`));
  const studentRole = new Map<string, string[]>();
  const addRole = (id: string, role: string) => studentRole.set(id, [...(studentRole.get(id) ?? []), role]);
  summary.misconceptionStudentIds.forEach((id) => addRole(id, "shared misconception"));
  summary.staleStudentIds.forEach((id) => addRole(id, "stale data"));
  addRole(summary.fluctuatingStudentId, "declining trend");
  addRole(summary.conflictingStudentId, "conflicting signals");
  addRole(summary.multiGroupStudentId, "fits two groups");

  // ---- M1: approved + mapped content. Focus skill gets material (reteach
  // candidate); the content-gap skill deliberately gets none. ----
  async function approveAndMap(nodeId: string, title: string, sections: number): Promise<string> {
    const parts: string[] = [];
    for (let i = 0; i < sections; i++) parts.push(`# Topic ${String.fromCharCode(65 + i)}\nExplain the idea clearly in prose.`);
    const up = await ctx.content.uploadOne(schoolId, teacherId, {
      title, fileType: "pdf", sizeBytes: 2048, contentHash: `demo-hash-${hashSeq++}`, source: { text: parts.join("\n") },
    });
    if (up.status !== "accepted") throw new Error(`content upload not accepted: ${up.reason}`);
    const item = (await ctx.contentStore.getContentItem(up.contentItemId))!;
    await ctx.ingestion.ingest(item.currentVersionId, teacherId);
    await ctx.classification.classify(up.contentItemId, teacherId);
    await ctx.classification.approveClassification(up.contentItemId, teacherId);
    await ctx.content.attestRights(up.contentItemId, teacherId);
    await ctx.content.approveContent(up.contentItemId, teacherId);
    await ctx.mapping.mapContent(up.contentItemId, [nodeId], { difficulty: "developing" });
    contentTitle.set(up.contentItemId, title);
    return up.contentItemId;
  }
  await approveAndMap(summary.focusNodeId, "Reteach: " + (nodeLabel.get(summary.focusNodeId) ?? "focus skill"), 3);
  await approveAndMap(summary.misconceptionNodeId, "Fractions foundations pack", 2);

  // A draft (pending) upload too, so the Content screen shows the approval gate.
  const pending = await ctx.content.uploadOne(schoolId, teacherId, {
    title: "Draft worksheet (awaiting approval)", fileType: "pdf", sizeBytes: 1024,
    contentHash: `demo-hash-${hashSeq++}`, source: { text: "# Draft\nNot yet approved." },
  });
  if (pending.status === "accepted") contentTitle.set(pending.contentItemId, "Draft worksheet (awaiting approval)");

  // ---- M3: a grounded, published assessment on the focus skill ----
  const gen = await ctx.assessment.generate(schoolId, teacherId, {
    title: "Fractions check-in", nodeId: summary.focusNodeId, count: 3, difficulty: "mixed",
  });
  if (gen.status === "generated") {
    await ctx.assessment.acknowledgeReview(gen.assessmentId, teacherId);
    await ctx.assessment.publish(gen.assessmentId, teacherId);
    // Put one stale student mid-assessment so the spaced-revision deferral shows.
    try { await ctx.assessment.startAttempt(gen.assessmentId, summary.staleStudentIds[0]!); } catch { /* best-effort demo */ }
  }
  // A second, still-draft assessment so the publish gate is visible.
  await ctx.assessment.generate(schoolId, teacherId, {
    title: "Integers quiz (draft)", nodeId: summary.misconceptionNodeId, count: 2, difficulty: "mixed",
  });

  return {
    schoolId, campusId, classId: klass.id, emptyClassId: emptyClass.id,
    adminId: admin.user.id, teacherId, versionId: version.id, summary,
    studentLabel, studentRole, nodeLabel, contentTitle,
  };
}

function getWorld(ctx: AppContext): Promise<DemoWorld> {
  building ??= bootstrap(ctx);
  return building;
}

/** Register the preview console API on the app, sharing the given context. */
export function registerPreview(app: FastifyInstance, ctx: AppContext): void {
  const label = (w: DemoWorld, id: string) => w.nodeLabel.get(id) ?? id;
  const sLabel = (w: DemoWorld, id: string) => w.studentLabel.get(id) ?? id;

  app.get("/api/brand", async () => ({
    brand: DEFAULT_BRAND_TOKENS,
    governance: GOVERNANCE_TOKENS,
  }));

  app.get("/api/overview", async () => {
    const w = await getWorld(ctx);
    const school = await ctx.store.getSchool(w.schoolId);
    const items = await ctx.contentStore.listContentItemsBySchool(w.schoolId);
    const version = await ctx.skillGraphStore.getGraphVersion(w.versionId);
    const students = await ctx.synthetic.listSyntheticStudents(w.schoolId);
    const assessments = await ctx.assessmentStore.listAssessmentsByTeacher(w.teacherId);
    return {
      school: { id: w.schoolId, name: school?.name },
      milestones: [
        { id: "M0", name: "Admin & onboarding", detail: "School, campus, accounts, roles, login", route: "admin" },
        { id: "M1", name: "Content Studio", detail: `${items.length} items, ${items.filter((i) => i.governance.status === "approved" || i.governance.status === "published").length} approved`, route: "content" },
        { id: "M2", name: "Skill Graph", detail: `${(await ctx.skillGraphStore.listNodes(w.versionId)).length} nodes · ${version?.status === "signed_off" ? "signed off" : "draft"}`, route: "skillgraph" },
        { id: "M3", name: "Assessment Builder", detail: `${assessments.length} assessments`, route: "assessments" },
        { id: "M4", name: "Synthetic activity", detail: `${students.length} synthetic students (quarantined)`, route: "synthetic" },
        { id: "M5a", name: "Teacher Dashboard", detail: "Heatmap, focus areas, cohorts, adaptive", route: "dashboard" },
      ],
    };
  });

  app.get("/api/admin", async () => {
    const w = await getWorld(ctx);
    const school = await ctx.store.getSchool(w.schoolId);
    const campuses = await ctx.store.listCampusesBySchool(w.schoolId);
    const classes = await ctx.store.listClassesBySchool(w.schoolId);
    const memberships = await ctx.store.listMembershipsBySchool(w.schoolId);
    const accounts: { name: string; role: string; classId: string | null }[] = [];
    for (const m of memberships) {
      if (m.role === "student") continue; // synthetic students shown on their own screen
      const pd = await ctx.store.getPersonalData(m.userId);
      accounts.push({ name: pd ? `${pd.firstName} ${pd.lastName}` : m.userId, role: m.role, classId: m.classId });
    }
    return {
      school: { name: school?.name, id: w.schoolId },
      campuses: campuses.map((c) => ({ id: c.id, name: c.name })),
      classes: classes.map((c) => ({ id: c.id, name: c.name })),
      accounts,
    };
  });

  app.get("/api/content", async () => {
    const w = await getWorld(ctx);
    const items = await ctx.contentStore.listContentItemsBySchool(w.schoolId);
    const rows = [];
    for (const item of items) {
      const mappings = await ctx.skillGraphStore.listMappingsByContent(item.id);
      rows.push({
        id: item.id,
        title: w.contentTitle.get(item.id) ?? item.title,
        status: item.governance.status,
        mappedSkills: mappings.map((m) => label(w, m.nodeId)),
      });
    }
    return { items: rows };
  });

  app.get("/api/skillgraph", async () => {
    const w = await getWorld(ctx);
    const version = await ctx.skillGraphStore.getGraphVersion(w.versionId);
    const nodes = await ctx.skillGraphStore.listNodes(w.versionId);
    const edges = await ctx.skillGraphStore.listEdges(w.versionId);
    const byType: Record<string, { id: string; label: string; code?: string }[]> = {};
    for (const n of nodes) (byType[n.type] ??= []).push({ id: n.id, label: n.label, code: n.code });
    return {
      version: { id: version?.id, name: version?.name, status: version?.status, signedOffBy: version?.signedOffBy },
      counts: { nodes: nodes.length, edges: edges.length },
      byType,
    };
  });

  app.get("/api/assessments", async () => {
    const w = await getWorld(ctx);
    const list = await ctx.assessmentStore.listAssessmentsByTeacher(w.teacherId);
    const rows = [];
    for (const a of list) {
      const questions = await ctx.assessmentStore.listQuestionsByAssessment(a.id);
      rows.push({
        id: a.id, title: a.title, status: a.status,
        skill: label(w, a.request.nodeId),
        questionCount: questions.length,
        shortfall: a.shortfall,
        reviewAcknowledged: a.reviewAcknowledged,
      });
    }
    return { assessments: rows };
  });

  app.post("/api/assessments/:id/publish", async (req) => {
    const w = await getWorld(ctx);
    const { id } = req.params as { id: string };
    await ctx.assessment.acknowledgeReview(id, w.teacherId).catch(() => {});
    const a = await ctx.assessment.publish(id, w.teacherId);
    return { id: a.id, status: a.status };
  });

  app.get("/api/synthetic", async () => {
    const w = await getWorld(ctx);
    const students = await ctx.synthetic.listSyntheticStudents(w.schoolId);
    const t = ctx.synthetic.thresholds();
    return {
      count: students.length,
      thresholds: t,
      quarantine: [
        "Flagged synthetic at the schema level (users.synthetic)",
        "Hold no personal data (PII-free)",
        "Excluded from every real / export / parent surface",
        "Deletable before pilot go-live (audited)",
      ],
      students: w.summary.studentIds.map((id) => ({
        label: w.studentLabel.get(id), roles: w.studentRole.get(id) ?? [],
      })),
    };
  });

  app.get("/api/dashboard", async () => {
    const w = await getWorld(ctx);
    const heatmap = await ctx.dashboard.heatmap(w.schoolId, w.classId);
    const empty = await ctx.dashboard.heatmap(w.schoolId, w.emptyClassId);
    const focusAreas = await ctx.dashboard.classFocusAreas(w.schoolId, w.classId);
    const groups = await ctx.cohorts.suggestGroups(w.schoolId, w.classId);
    const escalations = await ctx.adaptive.escalations(w.schoolId, w.classId);
    const reminders = await ctx.adaptive.dueRevisionReminders(w.schoolId, w.classId);

    // A few adaptive recommendations, one per landmark, to showcase the engine.
    const s = w.summary;
    const recoTargets = [
      { studentId: s.multiGroupStudentId, nodeId: s.focusNodeId },
      { studentId: s.conflictingStudentId, nodeId: s.conflictingNodeId },
      { studentId: s.misconceptionStudentIds[0]!, nodeId: s.misconceptionNodeId },
      { studentId: s.fluctuatingStudentId, nodeId: s.focusNodeId },
    ];
    const recommendations = [];
    for (const target of recoTargets) {
      const a = await ctx.adaptive.nextAction(w.schoolId, target.studentId, target.nodeId);
      recommendations.push({
        student: sLabel(w, target.studentId), skill: label(w, target.nodeId),
        action: a.action, reason: a.reason, escalated: a.escalated,
      });
    }

    return {
      class: { id: w.classId, name: "Year 8 Maths — 8A" },
      emptyClass: { name: "Year 8 Maths — 8B (new)", enoughData: empty.enoughData },
      skills: heatmap.skills.map((id) => ({ id, label: label(w, id) })),
      students: heatmap.students.map((id) => ({ id, label: sLabel(w, id), roles: w.studentRole.get(id) ?? [] })),
      heatmap: {
        enoughData: heatmap.enoughData,
        cells: heatmap.cells.map((c) => ({
          studentId: c.studentId, studentLabel: sLabel(w, c.studentId),
          nodeId: c.nodeId, skill: label(w, c.nodeId),
          level: c.level, score: c.score, trend: c.trend,
          insufficientData: c.insufficientData, stale: c.stale,
        })),
        flags: heatmap.flags.map((f) => ({ student: sLabel(w, f.studentId), skill: label(w, f.nodeId), kind: f.kind })),
      },
      focusAreas: focusAreas.map((a) => ({
        skill: label(w, a.nodeId), belowCount: a.belowCount, total: a.total,
        belowFraction: a.belowFraction, contentGap: a.contentGap,
        suggestedMaterial: a.suggestedContentIds.map((id) => w.contentTitle.get(id) ?? id),
      })),
      groups: groups.map((g) => ({
        type: g.type, label: g.label, skill: g.nodeId ? label(w, g.nodeId) : null,
        basis: g.basis, staleNote: g.staleNote,
        students: g.studentIds.map((id) => sLabel(w, id)),
      })),
      escalations: escalations.map((e) => ({
        student: sLabel(w, e.studentId), skill: label(w, e.nodeId),
        misconception: e.misconception, occurrences: e.occurrences,
      })),
      reminders: {
        total: reminders.length,
        deferred: reminders.filter((r) => r.deferred).length,
        sample: reminders.slice(0, 6).map((r) => ({
          student: sLabel(w, r.studentId), skill: label(w, r.nodeId), deferred: r.deferred, reason: r.reason,
        })),
      },
      recommendations,
    };
  });

  app.post("/api/dashboard/focus/dismiss", async (req) => {
    const w = await getWorld(ctx);
    const { skillLabel } = req.body as { skillLabel: string };
    // Resolve the label back to a node id.
    const nodeId = [...w.nodeLabel.entries()].find(([, l]) => l === skillLabel)?.[0];
    if (nodeId) await ctx.dashboard.dismissFocusArea(w.teacherId, w.schoolId, w.classId, nodeId);
    return { dismissed: Boolean(nodeId) };
  });
}
