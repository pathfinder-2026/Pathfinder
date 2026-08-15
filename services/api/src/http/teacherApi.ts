import type { FastifyInstance, FastifyRequest } from "fastify";
import { AuthError, NotFoundError } from "../domain/errors";
import type { AppContext } from "../context";
import type { ContentItem } from "../domain/content";
import type { Assessment } from "../domain/assessment";
import { anonymityRisk, PEER_THRESHOLDS, type PeerTest } from "../domain/peer";
import type { AgentSuggestion } from "../domain/agent";

/**
 * Production HTTP surface for the Teacher workflow thread (TCH-1/3/4/5/6):
 * content -> approve -> map -> assessment -> publish -> dashboard. Mounted under
 * /api/v1 next to the Admin surface; consumed by apps/app.
 *
 * Every route is session-guarded and school-scoped, and only wraps the
 * already-tested domain services — no business logic lives here. Governance
 * moments (approve classification, attest rights, approve content, acknowledge
 * review, publish) are each an explicit endpoint so the UI must surface them as
 * explicit teacher actions (Decision 7).
 */
export function registerTeacherApi(app: FastifyInstance, ctx: AppContext): void {
  const bearer = (req: FastifyRequest): string => {
    const header = req.headers.authorization ?? "";
    return header.startsWith("Bearer ") ? header.slice(7) : "";
  };

  /** Resolve the caller and assert they hold the Teacher role in `schoolId`. */
  const requireTeacherOf = async (req: FastifyRequest, schoolId: string) => {
    const auth = await ctx.auth.authorize(bearer(req));
    if (!auth.roles.includes("teacher")) throw new AuthError("Teacher role required.", "TEACHER_ROLE_REQUIRED");
    if (auth.user.schoolId !== schoolId) throw new AuthError("Not a member of this school.");
    return auth;
  };

  /** Fetch a content item and assert it belongs to `schoolId`. */
  const requireItemIn = async (schoolId: string, itemId: string): Promise<ContentItem> => {
    const item = await ctx.contentStore.getContentItem(itemId);
    if (!item || item.schoolId !== schoolId) throw new NotFoundError("Content item not found.");
    return item;
  };

  /** Fetch an assessment and assert it belongs to `schoolId`. */
  const requireAssessmentIn = async (schoolId: string, id: string): Promise<Assessment> => {
    const a = await ctx.assessmentStore.getAssessment(id);
    if (!a || a.schoolId !== schoolId) throw new NotFoundError("Assessment not found.");
    return a;
  };

  /** Deterministic content hash (FNV-1a) so dedup works without client hashing. */
  const contentHash = (text: string): string => {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return `fnv-${h.toString(16)}`;
  };

  /** Signed-off graph version for the school's curriculum, or undefined. */
  const signedVersion = async (schoolId: string) => {
    const config = await ctx.skillGraphStore.getSchoolCurriculum(schoolId);
    return ctx.skillGraphStore.latestSignedOffVersion(config?.curriculum ?? "NSW");
  };

  /** Enriched library row: item + version pipeline state + classification + mappings. */
  const contentRow = async (item: ContentItem) => {
    const version = await ctx.contentStore.getContentVersion(item.currentVersionId);
    const classification = await ctx.classification.getClassification(item.id);
    const mappings = await ctx.skillGraphStore.listMappingsByContent(item.id);
    const blockReason = item.governance.status === "approved" || item.governance.status === "published"
      ? null
      : await ctx.content.prerequisiteBlockReason(item);
    return {
      id: item.id,
      title: item.title,
      status: item.governance.status,
      rightsAttested: item.rightsAttested,
      archived: item.archived,
      fileType: version?.fileType ?? null,
      ingestionStatus: version?.ingestionStatus ?? null,
      scanStatus: version?.scanStatus ?? null,
      classification: classification
        ? {
            status: classification.status,
            subject: classification.subject,
            topic: classification.topic,
            year: classification.year,
            difficulty: classification.difficulty,
            confidence: classification.confidence,
            lowConfidence: classification.lowConfidence,
          }
        : null,
      mappedNodeIds: mappings.map((m) => m.nodeId),
      approvalBlockReason: blockReason,
      officialSyllabus: item.officialSyllabus,
      createdAt: item.createdAt,
    };
  };

  // ---- Content Studio (TCH-1): library + upload + pipeline governance ----
  app.get("/api/v1/schools/:schoolId/content", async (req, reply) => {
    const { schoolId } = req.params as { schoolId: string };
    const auth = await requireTeacherOf(req, schoolId);
    const items = await ctx.content.browseSharedLibrary(auth.user.id, schoolId);
    return reply.send(await Promise.all(items.map(contentRow)));
  });

  app.post("/api/v1/schools/:schoolId/content", async (req, reply) => {
    const { schoolId } = req.params as { schoolId: string };
    const auth = await requireTeacherOf(req, schoolId);
    const { title, fileType, text } = req.body as { title: string; fileType: string; text: string };
    const body = text ?? "";
    const result = await ctx.content.uploadOne(schoolId, auth.user.id, {
      title,
      fileType,
      sizeBytes: Buffer.byteLength(body, "utf8") || 1,
      contentHash: contentHash(`${title}\n${body}`),
      source: { text: body },
    });
    return reply.status(result.status === "accepted" ? 201 : 200).send(result);
  });

  app.get("/api/v1/schools/:schoolId/content/:itemId", async (req, reply) => {
    const { schoolId, itemId } = req.params as { schoolId: string; itemId: string };
    await requireTeacherOf(req, schoolId);
    const item = await requireItemIn(schoolId, itemId);
    return reply.send(await contentRow(item));
  });

  app.post("/api/v1/schools/:schoolId/content/:itemId/ingest", async (req, reply) => {
    const { schoolId, itemId } = req.params as { schoolId: string; itemId: string };
    const auth = await requireTeacherOf(req, schoolId);
    const item = await requireItemIn(schoolId, itemId);
    const outcome = await ctx.ingestion.ingest(item.currentVersionId, auth.user.id);
    return reply.send({ status: outcome.status, chunks: outcome.chunks.length, concepts: outcome.concepts.length });
  });

  app.post("/api/v1/schools/:schoolId/content/:itemId/classify", async (req, reply) => {
    const { schoolId, itemId } = req.params as { schoolId: string; itemId: string };
    const auth = await requireTeacherOf(req, schoolId);
    await requireItemIn(schoolId, itemId);
    const c = await ctx.classification.classify(itemId, auth.user.id);
    return reply.send({
      status: c.status, subject: c.subject, topic: c.topic, year: c.year,
      difficulty: c.difficulty, confidence: c.confidence, lowConfidence: c.lowConfidence,
    });
  });

  app.post("/api/v1/schools/:schoolId/content/:itemId/classification/approve", async (req, reply) => {
    const { schoolId, itemId } = req.params as { schoolId: string; itemId: string };
    const auth = await requireTeacherOf(req, schoolId);
    await requireItemIn(schoolId, itemId);
    const c = await ctx.classification.approveClassification(itemId, auth.user.id);
    return reply.send({ status: c.status });
  });

  app.post("/api/v1/schools/:schoolId/content/:itemId/attest", async (req, reply) => {
    const { schoolId, itemId } = req.params as { schoolId: string; itemId: string };
    const auth = await requireTeacherOf(req, schoolId);
    await requireItemIn(schoolId, itemId);
    const item = await ctx.content.attestRights(itemId, auth.user.id);
    return reply.send({ rightsAttested: item.rightsAttested });
  });

  app.post("/api/v1/schools/:schoolId/content/:itemId/approve", async (req, reply) => {
    const { schoolId, itemId } = req.params as { schoolId: string; itemId: string };
    const auth = await requireTeacherOf(req, schoolId);
    await requireItemIn(schoolId, itemId);
    const item = await ctx.content.approveContent(itemId, auth.user.id);
    return reply.send({ status: item.governance.status });
  });

  // ---- Official syllabus (ADR-0035): tag a document as THE syllabus for a
  // subject + year, so any teacher of that subject/year can find it and draft
  // straight from it, instead of re-uploading. NESA has no public curriculum
  // API, so the source link is whatever the uploader pastes in — never
  // generated by this app.
  app.post("/api/v1/schools/:schoolId/content/:itemId/mark-official-syllabus", async (req, reply) => {
    const { schoolId, itemId } = req.params as { schoolId: string; itemId: string };
    const auth = await requireTeacherOf(req, schoolId);
    await requireItemIn(schoolId, itemId);
    const { subject, yearLevel, sourceUrl } = req.body as { subject: string; yearLevel: number; sourceUrl: string };
    const item = await ctx.content.markOfficialSyllabus(itemId, auth.user.id, { subject, yearLevel, sourceUrl });
    return reply.send({ officialSyllabus: item.officialSyllabus });
  });

  /**
   * The official syllabus on file for a subject + year, with its mapped
   * topics (readable label chains, e.g. ["Mathematics","Number and
   * Algebra","Fractions"]) so the teacher's topic picker can be limited to
   * exactly what this syllabus covers instead of the whole skill library.
   * `found: false` is an honest state — no fetch happens; the caller is
   * expected to point the teacher at NESA's site to source one manually.
   */
  app.get("/api/v1/schools/:schoolId/syllabus", async (req, reply) => {
    const { schoolId } = req.params as { schoolId: string };
    await requireTeacherOf(req, schoolId);
    const { subject, yearLevel } = req.query as { subject?: string; yearLevel?: string };
    if (!subject || !yearLevel) {
      return reply.status(400).send({ code: "BAD_REQUEST", message: "subject and yearLevel are required." });
    }
    const item = await ctx.content.getOfficialSyllabus(schoolId, subject, Number(yearLevel));
    if (!item) return reply.send({ found: false });
    const views = await ctx.mapping.mappingViews(item.id);
    return reply.send({
      found: true,
      item: await contentRow(item),
      topics: views.map((v) => ({ nodeId: v.mapping.nodeId, label: v.chain[v.chain.length - 1]?.label ?? v.mapping.nodeId, chain: v.chain.map((n) => n.label) })),
    });
  });

  // ---- Skill mapping (TCH-3, minimal): map approved content to graph nodes ----
  app.post("/api/v1/schools/:schoolId/content/:itemId/map", async (req, reply) => {
    const { schoolId, itemId } = req.params as { schoolId: string; itemId: string };
    await requireTeacherOf(req, schoolId);
    await requireItemIn(schoolId, itemId);
    const { nodeIds, difficulty } = req.body as { nodeIds: string[]; difficulty?: string };
    const mappings = await ctx.mapping.mapContent(itemId, nodeIds ?? [], { source: "teacher", difficulty });
    return reply.status(201).send(mappings.map((m) => ({ id: m.id, nodeId: m.nodeId, flags: m.flags })));
  });

  /**
   * Skill nodes of the school's signed-off graph — the node picker for mapping
   * and assessment generation. `signedOff:false` is an honest state the UI must
   * render (mapping is blocked in the domain until a human signs the graph off).
   */
  app.get("/api/v1/schools/:schoolId/skills", async (req, reply) => {
    const { schoolId } = req.params as { schoolId: string };
    await requireTeacherOf(req, schoolId);
    const version = await signedVersion(schoolId);
    if (!version) {
      const all = await ctx.skillGraphStore.listGraphVersions();
      return reply.send({ signedOff: false, hasDraft: all.some((v) => v.status !== "signed_off") });
    }
    const nodes = await ctx.skillGraphStore.listNodes(version.id);
    return reply.send({
      signedOff: true,
      versionId: version.id,
      versionName: version.name,
      nodes: nodes.map((n) => ({ id: n.id, label: n.label, code: n.code ?? null, type: n.type })),
    });
  });

  // ---- Assessment Builder + review/publish (TCH-4/5) ----

  /**
   * Per-skill grounding capacity (questions each node can support right now) —
   * drives the content-aware skill picker so teachers can't request what the
   * approved pool can't deliver.
   */
  app.get("/api/v1/schools/:schoolId/assessment-capacity", async (req, reply) => {
    const { schoolId } = req.params as { schoolId: string };
    await requireTeacherOf(req, schoolId);
    return reply.send(await ctx.assessment.groundingCapacity(schoolId));
  });

  app.get("/api/v1/schools/:schoolId/assessments", async (req, reply) => {
    const { schoolId } = req.params as { schoolId: string };
    const auth = await requireTeacherOf(req, schoolId);
    const list = (await ctx.assessmentStore.listAssessmentsByTeacher(auth.user.id)).filter((a) => a.schoolId === schoolId);
    const rows = await Promise.all(list.map(async (a) => ({
      id: a.id,
      title: a.title,
      status: a.status,
      nodeId: a.request.nodeId,
      questionCount: (await ctx.assessmentStore.listQuestionsByAssessment(a.id)).length,
      shortfall: a.shortfall,
      reviewAcknowledged: a.reviewAcknowledged,
      flags: a.flags,
      publishedAt: a.publishedAt,
      targetStudentId: a.request.targetStudentId ?? null,
      tailoringRationale: a.request.tailoringRationale ?? null,
      createdAt: a.createdAt,
    })));
    return reply.send(rows);
  });

  app.post("/api/v1/schools/:schoolId/assessments/generate", async (req, reply) => {
    const { schoolId } = req.params as { schoolId: string };
    const auth = await requireTeacherOf(req, schoolId);
    const { title, nodeId, count, difficulty } = req.body as {
      title: string; nodeId: string; count: number; difficulty?: "easy" | "mixed" | "hard";
    };
    const result = await ctx.assessment.generate(schoolId, auth.user.id, {
      title, nodeId, count, difficulty: difficulty ?? "mixed",
    });
    // "failed" is a clean, honest state (no partial draft saved) — still HTTP 200.
    return reply.status(result.status === "generated" ? 201 : 200).send(result);
  });

  /**
   * Generate a draft tailored to ONE student's adaptive recommendation
   * (TCH-19) — composes the same recommendation the "next action" panel
   * already shows, so the teacher sees exactly why before triggering this.
   */
  app.post("/api/v1/schools/:schoolId/classes/:classId/students/:studentId/assessments/generate-tailored", async (req, reply) => {
    const { schoolId, classId, studentId } = req.params as { schoolId: string; classId: string; studentId: string };
    const auth = await requireTeacherOf(req, schoolId);
    await requireClassIn(schoolId, classId);
    if (!(await classStudentIds(schoolId, classId)).includes(studentId)) {
      throw new NotFoundError("Student not found in this class.");
    }
    const { nodeId } = req.body as { nodeId: string };
    const recommendation = await ctx.adaptive.nextAction(schoolId, studentId, nodeId);
    const result = await ctx.assessment.generateTailored(schoolId, auth.user.id, {
      studentId, nodeId, action: recommendation.action, reason: recommendation.reason,
    });
    return reply.status(result.status === "generated" ? 201 : 200).send(result);
  });

  app.get("/api/v1/schools/:schoolId/assessments/:id", async (req, reply) => {
    const { schoolId, id } = req.params as { schoolId: string; id: string };
    await requireTeacherOf(req, schoolId);
    const a = await requireAssessmentIn(schoolId, id);
    const questions = await ctx.assessmentStore.listQuestionsByAssessment(id);
    // Resolve grounding sources to titles (archived-on-view keeps a reference, not a broken link).
    const groundingIds = [...new Set(questions.flatMap((q) => q.groundingContentIds))];
    const titles = new Map<string, string>();
    for (const gid of groundingIds) {
      const item = await ctx.contentStore.getContentItem(gid);
      titles.set(gid, item ? `${item.title}${item.archived ? " (archived)" : ""}` : gid);
    }
    return reply.send({
      id: a.id,
      title: a.title,
      status: a.status,
      nodeId: a.request.nodeId,
      shortfall: a.shortfall,
      flags: a.flags,
      reviewAcknowledged: a.reviewAcknowledged,
      publishedAt: a.publishedAt,
      scheduledStart: a.scheduledStart,
      targetStudentId: a.request.targetStudentId ?? null,
      tailoringRationale: a.request.tailoringRationale ?? null,
      questions: questions
        .sort((x, y) => x.order - y.order)
        .map((q) => ({
          id: q.id, order: q.order, type: q.type, prompt: q.prompt, options: q.options,
          modelAnswer: q.modelAnswer, rubric: q.rubric, difficulty: q.difficulty,
          reviewed: q.reviewed, groundingSources: q.groundingContentIds.map((gid) => titles.get(gid) ?? gid),
        })),
    });
  });

  /**
   * Every student attempt, WITH grading — reviewable by the teacher at any
   * time (never sent to the student; matches the existing model-answer/rubric
   * non-disclosure rule). Grading runs automatically on submit (TCH-19b: real
   * mastery data from real submissions, not just synthetic test seed data).
   */
  app.get("/api/v1/schools/:schoolId/assessments/:id/attempts", async (req, reply) => {
    const { schoolId, id } = req.params as { schoolId: string; id: string };
    await requireTeacherOf(req, schoolId);
    await requireAssessmentIn(schoolId, id);
    const attempts = await ctx.assessment.listAttempts(id);
    // One PII lookup per DISTINCT student, sequentially — a parallel per-attempt
    // fan-out here blew through the Supabase session pooler's client cap.
    const labels = new Map<string, string>();
    for (const studentId of new Set(attempts.map((a) => a.studentId))) {
      const pii = await ctx.store.getPersonalData(studentId);
      labels.set(studentId, pii ? `${pii.firstName} ${pii.lastName}` : studentId);
    }
    return reply.send(attempts.map((a) => ({
      id: a.id,
      studentId: a.studentId,
      studentLabel: labels.get(a.studentId) ?? a.studentId,
      status: a.status,
      interrupted: a.interrupted,
      gradedScore: a.gradedScore,
      gradedResults: a.gradedResults,
      gradedAt: a.gradedAt,
    })));
  });

  app.post("/api/v1/schools/:schoolId/assessments/:id/acknowledge-review", async (req, reply) => {
    const { schoolId, id } = req.params as { schoolId: string; id: string };
    const auth = await requireTeacherOf(req, schoolId);
    await requireAssessmentIn(schoolId, id);
    await ctx.assessment.acknowledgeReview(id, auth.user.id);
    return reply.send({ ok: true });
  });

  app.post("/api/v1/schools/:schoolId/assessments/:id/publish", async (req, reply) => {
    const { schoolId, id } = req.params as { schoolId: string; id: string };
    const auth = await requireTeacherOf(req, schoolId);
    await requireAssessmentIn(schoolId, id);
    const a = await ctx.assessment.publish(id, auth.user.id);
    return reply.send({ status: a.status, publishedAt: a.publishedAt });
  });

  app.post("/api/v1/schools/:schoolId/assessments/:id/unpublish", async (req, reply) => {
    const { schoolId, id } = req.params as { schoolId: string; id: string };
    const auth = await requireTeacherOf(req, schoolId);
    await requireAssessmentIn(schoolId, id);
    const a = await ctx.assessment.unpublish(id, auth.user.id);
    return reply.send({ status: a.status });
  });

  // ---- Teacher Dashboard heatmap (TCH-6) ----

  /** Assert the class exists in this school. */
  const requireClassIn = async (schoolId: string, classId: string) => {
    const klass = (await ctx.store.listClassesBySchool(schoolId)).find((c) => c.id === classId);
    if (!klass) throw new NotFoundError("Class not found in this school.");
    return klass;
  };

  /** The class's student ids, in stable membership order (label positions key off this). */
  const classStudentIds = async (schoolId: string, classId: string): Promise<string[]> =>
    (await ctx.store.listMembershipsBySchool(schoolId))
      .filter((m) => m.role === "student" && m.classId === classId)
      .map((m) => m.userId);

  /**
   * Display labels for the class's students. Synthetic students hold no PII by
   * design — they render as positional labels ("Student 03"), never fabricated
   * names. Positions are stable across every teacher surface (same class order).
   */
  const studentLabelMap = async (schoolId: string, classId: string): Promise<Record<string, string>> => {
    const labels: Record<string, string> = {};
    let position = 0;
    for (const studentId of await classStudentIds(schoolId, classId)) {
      position += 1;
      const pii = await ctx.store.getPersonalData(studentId);
      labels[studentId] = pii ? `${pii.firstName} ${pii.lastName}` : `Student ${String(position).padStart(2, "0")}`;
    }
    return labels;
  };

  /** Skill-node labels from the school's signed-off graph (empty pre-sign-off). */
  const nodeLabelMap = async (schoolId: string): Promise<Record<string, string>> => {
    const version = await signedVersion(schoolId);
    const labels: Record<string, string> = {};
    if (version) {
      for (const n of await ctx.skillGraphStore.listNodes(version.id)) labels[n.id] = n.label;
    }
    return labels;
  };

  app.get("/api/v1/schools/:schoolId/teacher/classes", async (req, reply) => {
    const { schoolId } = req.params as { schoolId: string };
    await requireTeacherOf(req, schoolId);
    const classes = await ctx.store.listClassesBySchool(schoolId);
    return reply.send(classes.map((c) => ({ id: c.id, name: c.name, yearGroup: c.yearGroup ?? null })));
  });

  app.get("/api/v1/schools/:schoolId/classes/:classId/heatmap", async (req, reply) => {
    const { schoolId, classId } = req.params as { schoolId: string; classId: string };
    await requireTeacherOf(req, schoolId);
    const klass = await requireClassIn(schoolId, classId);
    const heatmap = await ctx.dashboard.heatmap(schoolId, classId);
    const studentLabels = await studentLabelMap(schoolId, classId);
    const nodeLabels = await nodeLabelMap(schoolId);

    return reply.send({
      class: { id: klass.id, name: klass.name },
      enoughData: heatmap.enoughData,
      students: heatmap.students.map((id) => ({ id, label: studentLabels[id] ?? id })),
      skills: heatmap.skills.map((id) => ({ id, label: nodeLabels[id] ?? id })),
      cells: heatmap.cells.map((c) => ({
        studentId: c.studentId, nodeId: c.nodeId, level: c.level, score: c.score,
        trend: c.trend, insufficientData: c.insufficientData, stale: c.stale,
      })),
      flags: heatmap.flags.map((f) => ({ studentId: f.studentId, nodeId: f.nodeId, kind: f.kind })),
    });
  });

  // ---- Class intelligence (TCH-7/8/9): focus areas, cohorts, adaptive ----
  // Everything here is a Teacher-facing DRAFT/suggestion. Assigning is always an
  // explicit teacher action (Decision 7); the service layer additionally blocks
  // any non-teacher assign attempt (AUTO_ASSIGN_BLOCKED) beneath this guard.

  app.get("/api/v1/schools/:schoolId/classes/:classId/focus-areas", async (req, reply) => {
    const { schoolId, classId } = req.params as { schoolId: string; classId: string };
    await requireTeacherOf(req, schoolId);
    await requireClassIn(schoolId, classId);
    const areas = await ctx.dashboard.classFocusAreas(schoolId, classId);
    const nodeLabels = await nodeLabelMap(schoolId);
    return reply.send(await Promise.all(areas.map(async (a) => ({
      nodeId: a.nodeId,
      nodeLabel: nodeLabels[a.nodeId] ?? a.nodeId,
      belowCount: a.belowCount,
      total: a.total,
      belowFraction: a.belowFraction,
      contentGap: a.contentGap,
      suggested: await Promise.all(a.suggestedContentIds.map(async (id) => {
        const item = await ctx.contentStore.getContentItem(id);
        return { id, title: item?.title ?? id };
      })),
    }))));
  });

  app.post("/api/v1/schools/:schoolId/classes/:classId/focus-areas/:nodeId/dismiss", async (req, reply) => {
    const { schoolId, classId, nodeId } = req.params as { schoolId: string; classId: string; nodeId: string };
    const auth = await requireTeacherOf(req, schoolId);
    await requireClassIn(schoolId, classId);
    await ctx.dashboard.dismissFocusArea(auth.user.id, schoolId, classId, nodeId);
    return reply.send({ ok: true });
  });

  app.post("/api/v1/schools/:schoolId/classes/:classId/focus-areas/:nodeId/assign", async (req, reply) => {
    const { schoolId, classId, nodeId } = req.params as { schoolId: string; classId: string; nodeId: string };
    const auth = await requireTeacherOf(req, schoolId);
    await requireClassIn(schoolId, classId);
    const { contentId } = req.body as { contentId: string };
    const assignment = await ctx.dashboard.assignFocusMaterial(auth.user.id, schoolId, classId, nodeId, contentId);
    return reply.status(201).send({ id: assignment.id, students: assignment.studentIds.length });
  });

  app.get("/api/v1/schools/:schoolId/classes/:classId/cohorts", async (req, reply) => {
    const { schoolId, classId } = req.params as { schoolId: string; classId: string };
    await requireTeacherOf(req, schoolId);
    await requireClassIn(schoolId, classId);
    const groups = await ctx.cohorts.suggestGroups(schoolId, classId);
    const studentLabels = await studentLabelMap(schoolId, classId);
    const nodeLabels = await nodeLabelMap(schoolId);
    return reply.send(groups.map((g) => ({
      id: g.id,
      type: g.type,
      label: g.label,
      nodeId: g.nodeId,
      nodeLabel: g.nodeId ? nodeLabels[g.nodeId] ?? g.nodeId : null,
      basis: g.basis,
      staleNote: g.staleNote,
      students: g.studentIds.map((id) => ({ id, label: studentLabels[id] ?? id })),
    })));
  });

  app.post("/api/v1/schools/:schoolId/classes/:classId/cohorts/assign", async (req, reply) => {
    const { schoolId, classId } = req.params as { schoolId: string; classId: string };
    const auth = await requireTeacherOf(req, schoolId);
    await requireClassIn(schoolId, classId);
    const { type, nodeId, studentIds, contentId } = req.body as {
      type: "support" | "misconception" | "extension" | "review" | "peer-learning";
      nodeId: string | null; studentIds: string[]; contentId?: string | null;
    };
    // The membership posted here is FINAL — the teacher may have edited it.
    const assignment = await ctx.cohorts.assignWork(auth.user.id, schoolId, classId, {
      type, nodeId: nodeId ?? null, studentIds: studentIds ?? [], contentId: contentId ?? null,
    });
    return reply.status(201).send({ id: assignment.id, students: assignment.studentIds.length });
  });

  app.get("/api/v1/schools/:schoolId/classes/:classId/adaptive", async (req, reply) => {
    const { schoolId, classId } = req.params as { schoolId: string; classId: string };
    await requireTeacherOf(req, schoolId);
    await requireClassIn(schoolId, classId);
    const [escalations, reminders, studentLabels, nodeLabels] = await Promise.all([
      ctx.adaptive.escalations(schoolId, classId),
      ctx.adaptive.dueRevisionReminders(schoolId, classId),
      studentLabelMap(schoolId, classId),
      nodeLabelMap(schoolId),
    ]);
    const students = await classStudentIds(schoolId, classId);
    return reply.send({
      students: students.map((id) => ({ id, label: studentLabels[id] ?? id })),
      escalations: escalations.map((e) => ({
        studentId: e.studentId,
        studentLabel: studentLabels[e.studentId] ?? e.studentId,
        nodeId: e.nodeId,
        nodeLabel: nodeLabels[e.nodeId] ?? e.nodeId,
        misconception: e.misconception,
        occurrences: e.occurrences,
      })),
      reminders: reminders.map((r) => ({
        studentId: r.studentId,
        studentLabel: studentLabels[r.studentId] ?? r.studentId,
        nodeId: r.nodeId,
        nodeLabel: nodeLabels[r.nodeId] ?? r.nodeId,
        deferred: r.deferred,
        reason: r.reason,
      })),
    });
  });

  app.get("/api/v1/schools/:schoolId/classes/:classId/adaptive/next-action", async (req, reply) => {
    const { schoolId, classId } = req.params as { schoolId: string; classId: string };
    await requireTeacherOf(req, schoolId);
    await requireClassIn(schoolId, classId);
    const { studentId, nodeId } = req.query as { studentId?: string; nodeId?: string };
    if (!studentId || !nodeId) {
      return reply.status(400).send({ code: "BAD_REQUEST", message: "studentId and nodeId are required." });
    }
    // Scope: only students of this class can be looked up from this route.
    if (!(await classStudentIds(schoolId, classId)).includes(studentId)) {
      throw new NotFoundError("Student not found in this class.");
    }
    const action = await ctx.adaptive.nextAction(schoolId, studentId, nodeId);
    return reply.send(action);
  });

  // ---- Peer suite (TCH-10..12): builder, delivery, results, review moderation ----
  // Computed benchmarks follow publish-or-withhold (default withheld, never
  // auto-released); corrections go through the separate logged path; peer
  // reviews are moderated approve/reject only — never rewritten.

  /** Class students (id + no-PII label) — the cohort picker for the builder. */
  app.get("/api/v1/schools/:schoolId/classes/:classId/students", async (req, reply) => {
    const { schoolId, classId } = req.params as { schoolId: string; classId: string };
    await requireTeacherOf(req, schoolId);
    await requireClassIn(schoolId, classId);
    const labels = await studentLabelMap(schoolId, classId);
    return reply.send((await classStudentIds(schoolId, classId)).map((id) => ({ id, label: labels[id] })));
  });

  const peerTestRow = (t: PeerTest) => ({
    id: t.id, title: t.title, nodeId: t.nodeId, questionCount: t.questionCount,
    cohortSize: t.cohort.length, cohort: t.cohort, anonymity: t.anonymity,
    accommodations: t.accommodations.length, status: t.status,
    benchmarkPublish: t.benchmarkPublish, scheduledStart: t.scheduledStart,
    warnings: t.warnings, createdAt: t.createdAt,
  });

  app.get("/api/v1/schools/:schoolId/peer-tests", async (req, reply) => {
    const { schoolId } = req.params as { schoolId: string };
    await requireTeacherOf(req, schoolId);
    const tests = await ctx.peerStore.listPeerTestsBySchool(schoolId);
    return reply.send(tests.map(peerTestRow));
  });

  app.post("/api/v1/schools/:schoolId/peer-tests", async (req, reply) => {
    const { schoolId } = req.params as { schoolId: string };
    const auth = await requireTeacherOf(req, schoolId);
    const body = req.body as {
      title: string; nodeId: string; questionCount: number; rubric?: string | null;
      cohort: string[]; anonymity: "named" | "anonymous";
      accommodations?: { studentId: string; kind: string }[];
    };
    const test = await ctx.peerTests.buildPeerTest(auth.user.id, schoolId, {
      title: body.title, nodeId: body.nodeId, questionCount: body.questionCount,
      rubric: body.rubric ?? null, cohort: body.cohort ?? [],
      anonymity: body.anonymity, accommodations: body.accommodations ?? [],
    });
    // Warnings (shortfall / accommodation-vs-anonymity) surface in the response —
    // the test is still created as a draft; nothing is silently applied.
    return reply.status(201).send(peerTestRow(test));
  });

  /** Lifecycle actions share one wrapper: each is an explicit teacher action. */
  const peerAction = (
    path: string,
    run: (teacherId: string, id: string, body: Record<string, unknown>) => Promise<unknown>,
  ) => {
    app.post(`/api/v1/schools/:schoolId/peer-tests/:id/${path}`, async (req, reply) => {
      const { schoolId, id } = req.params as { schoolId: string; id: string };
      const auth = await requireTeacherOf(req, schoolId);
      const test = await ctx.peerStore.getPeerTest(id);
      if (!test || test.schoolId !== schoolId) throw new NotFoundError("Peer test not found.");
      const result = await run(auth.user.id, id, (req.body ?? {}) as Record<string, unknown>);
      return reply.send(result);
    });
  };

  peerAction("schedule", async (tid, id, b) => peerTestRow(await ctx.peerTests.schedule(tid, id, String(b.scheduledStart))));
  peerAction("cohort", async (tid, id, b) => peerTestRow(await ctx.peerTests.addToCohort(tid, id, String(b.studentId))));
  peerAction("launch", async (tid, id) => peerTestRow(await ctx.peerTests.launch(tid, id)));
  peerAction("cancel", async (tid, id) => peerTestRow(await ctx.peerTests.cancel(tid, id)));
  peerAction("close", async (tid, id) => peerTestRow(await ctx.peerTests.close(tid, id)));
  peerAction("publish-benchmark", async (tid, id) => peerTestRow(await ctx.peerTests.publish(tid, id)));
  peerAction("withhold-benchmark", async (tid, id) => peerTestRow(await ctx.peerTests.withhold(tid, id)));
  peerAction("corrections", async (tid, id, b) => {
    await ctx.peerTests.recordCorrection(tid, id, String(b.studentId), Number(b.correctedScore), String(b.reason ?? ""));
    return { ok: true };
  });
  // Grading is a teacher act: the graded result enters through this seam
  // (out-of-band marking in the MVP); NOT_LIVE surfaces for unlaunched tests.
  peerAction("submissions", async (_tid, id, b) => {
    await ctx.peerTests.recordSubmission(id, String(b.studentId), Number(b.score));
    return { ok: true };
  });

  app.get("/api/v1/schools/:schoolId/peer-tests/:id/results", async (req, reply) => {
    const { schoolId, id } = req.params as { schoolId: string; id: string };
    const auth = await requireTeacherOf(req, schoolId);
    const test = await ctx.peerStore.getPeerTest(id);
    if (!test || test.schoolId !== schoolId) throw new NotFoundError("Peer test not found.");
    const results = await ctx.peerTests.results(auth.user.id, id);
    // Resolve benchmark student ids to no-PII labels for display.
    const labels: Record<string, string> = {};
    let position = 0;
    for (const sid of test.cohort) {
      position += 1;
      const pii = await ctx.store.getPersonalData(sid);
      labels[sid] = pii ? `${pii.firstName} ${pii.lastName}` : `Student ${String(position).padStart(2, "0")}`;
    }
    return reply.send({
      completion: results.completion,
      publishState: results.publishState,
      requiresPublishDecision: results.requiresPublishDecision,
      benchmark: {
        suppressed: results.benchmark.suppressed,
        suppressionReason: results.benchmark.suppressionReason,
        students: results.benchmark.students.map((s) => ({
          studentId: s.studentId, label: labels[s.studentId] ?? s.studentId,
          score: s.score, percentile: s.percentile, band: s.band,
        })),
      },
    });
  });

  app.get("/api/v1/schools/:schoolId/peer-tests/:id/reviews/pending", async (req, reply) => {
    const { schoolId, id } = req.params as { schoolId: string; id: string };
    await requireTeacherOf(req, schoolId);
    const test = await ctx.peerStore.getPeerTest(id);
    if (!test || test.schoolId !== schoolId) throw new NotFoundError("Peer test not found.");
    const pending = await ctx.peerReviews.pendingForTest(id);
    // Reviewer identity is NEVER included — moderation is on the text alone.
    return reply.send({
      anonymityRisk: anonymityRisk(test.cohort.length, PEER_THRESHOLDS),
      reviews: pending.map((r) => ({ id: r.id, text: r.text, createdAt: r.createdAt })),
    });
  });

  app.post("/api/v1/schools/:schoolId/peer-reviews/:reviewId/moderate", async (req, reply) => {
    const { schoolId, reviewId } = req.params as { schoolId: string; reviewId: string };
    const auth = await requireTeacherOf(req, schoolId);
    const review = await ctx.peerStore.getReview(reviewId);
    if (!review || review.schoolId !== schoolId) throw new NotFoundError("Review not found.");
    const { decision } = req.body as { decision: "approve" | "reject" };
    // approve | reject only — there is deliberately no way to edit the text.
    const moderated = await ctx.peerReviews.moderate(auth.user.id, reviewId, decision);
    return reply.send({ id: moderated.id, moderationState: moderated.moderationState });
  });

  // ---- Teacher Agent (TCH-13): grounded drafts, honest declines, never auto-sent ----

  const suggestionRow = (s: AgentSuggestion) => ({
    id: s.id, kind: s.kind, title: s.title, content: s.content,
    grounding: s.grounding.map((g) => ({ title: g.title, archived: g.archived })),
    sensitiveSections: s.sensitiveSections,
    requiresExtraReview: s.requiresExtraReview,
    personalised: s.personalised, personalisationNote: s.personalisationNote,
    sent: s.sent, edited: s.edited, createdAt: s.createdAt,
  });

  app.get("/api/v1/schools/:schoolId/agent/suggestions", async (req, reply) => {
    const { schoolId } = req.params as { schoolId: string };
    await requireTeacherOf(req, schoolId);
    const list = await ctx.agent.listSuggestions(schoolId);
    return reply.send(list.map(suggestionRow));
  });

  app.post("/api/v1/schools/:schoolId/agent/generate", async (req, reply) => {
    const { schoolId } = req.params as { schoolId: string };
    const auth = await requireTeacherOf(req, schoolId);
    const body = req.body as {
      kind: "unit_sequence" | "lesson_plan" | "differentiation" | "parent_summary" | "feedback";
      nodeId: string; term?: string; topic?: string; classId?: string; studentId?: string;
      observations?: { category: string; text: string }[];
    };
    const observations = (body.observations ?? []).map((o) => ({ category: o.category as never, text: o.text }));
    const run = {
      unit_sequence: () => ctx.agent.draftUnitSequence(auth.user.id, schoolId, { nodeId: body.nodeId, term: body.term ?? "this term", topic: body.topic }),
      lesson_plan: () => ctx.agent.draftLessonPlan(auth.user.id, schoolId, { nodeId: body.nodeId, topic: body.topic }),
      differentiation: () => ctx.agent.draftDifferentiation(auth.user.id, schoolId, { nodeId: body.nodeId, classId: body.classId ?? "", topic: body.topic }),
      parent_summary: () => ctx.agent.draftParentSummary(auth.user.id, schoolId, { studentId: body.studentId ?? "", nodeId: body.nodeId, topic: body.topic, observations }),
      feedback: () => ctx.agent.draftFeedback(auth.user.id, schoolId, { studentId: body.studentId ?? "", nodeId: body.nodeId, topic: body.topic, observations }),
    }[body.kind];
    if (!run) return reply.status(400).send({ code: "BAD_REQUEST", message: "Unknown agent draft kind." });
    const result = await run();
    // A decline is an HONEST outcome, not an error — HTTP 200 with the reason.
    if (result.status === "declined") return reply.send({ status: "declined", reason: result.reason, message: result.message });
    return reply.status(201).send({ status: "suggested", suggestion: suggestionRow(result.suggestion) });
  });

  app.patch("/api/v1/schools/:schoolId/agent/suggestions/:id", async (req, reply) => {
    const { schoolId, id } = req.params as { schoolId: string; id: string };
    const auth = await requireTeacherOf(req, schoolId);
    const { content } = req.body as { content: string };
    const edited = await ctx.agent.editDraft(auth.user.id, id, content);
    return reply.send(suggestionRow(edited));
  });

  // ---- Ask-for-Help transcripts (TCH-14): assigning teacher ONLY ----
  // The M9 rule: the only path to a transcript is the assigning teacher. This
  // surface derives sessions from the teacher's own tasks, so another teacher, a
  // Principal, or any other role simply has nothing to list — and the transcript
  // read is re-checked in the domain (NOT_ASSIGNING_TEACHER). Never add these
  // routes to any Principal surface or export.

  app.get("/api/v1/schools/:schoolId/help-sessions", async (req, reply) => {
    const { schoolId } = req.params as { schoolId: string };
    const auth = await requireTeacherOf(req, schoolId);
    const tasks = (await ctx.workspaceStore.listTasksByTeacher(auth.user.id)).filter((t) => t.schoolId === schoolId);
    const rows: { sessionId: string; taskTitle: string; studentLabel: string; createdAt: string }[] = [];
    for (const task of tasks) {
      const session = await ctx.workspaceStore.findHelpSession(task.studentId, task.id);
      if (!session) continue;
      const pii = await ctx.store.getPersonalData(task.studentId);
      rows.push({
        sessionId: session.id,
        taskTitle: task.title,
        studentLabel: pii ? `${pii.firstName} ${pii.lastName}` : "Student",
        createdAt: session.createdAt,
      });
    }
    return reply.send(rows);
  });

  app.get("/api/v1/schools/:schoolId/help-sessions/:sessionId/transcript", async (req, reply) => {
    const { schoolId, sessionId } = req.params as { schoolId: string; sessionId: string };
    const auth = await requireTeacherOf(req, schoolId);
    const session = await ctx.workspaceStore.getHelpSession(sessionId);
    if (!session || session.schoolId !== schoolId) throw new NotFoundError("Help session not found.");
    // Domain re-check: only the assigning teacher (NOT_ASSIGNING_TEACHER otherwise).
    const messages = await ctx.askForHelp.transcript(auth.user.id, sessionId);
    return reply.send(messages.map((m) => ({ role: m.role, kind: m.kind, text: m.text, at: m.createdAt })));
  });

  // ---- Content detail: versions + sharing + orphaned questions (TCH-2) ----

  app.get("/api/v1/schools/:schoolId/content/:itemId/versions", async (req, reply) => {
    const { schoolId, itemId } = req.params as { schoolId: string; itemId: string };
    await requireTeacherOf(req, schoolId);
    const item = await requireItemIn(schoolId, itemId);
    const versions = await ctx.contentStore.listVersionsByItem(itemId);
    return reply.send(versions.map((v) => ({
      id: v.id, versionNumber: v.versionNumber, fileType: v.fileType, sizeBytes: v.sizeBytes,
      current: v.id === item.currentVersionId,
    })));
  });

  app.post("/api/v1/schools/:schoolId/content/:itemId/share", async (req, reply) => {
    const { schoolId, itemId } = req.params as { schoolId: string; itemId: string };
    const auth = await requireTeacherOf(req, schoolId);
    await requireItemIn(schoolId, itemId);
    const share = req.body as { type: "private" } | { type: "class"; classId: string } | { type: "department"; department: string };
    const item = await ctx.content.setShare(itemId, auth.user.id, share);
    return reply.send({ share: item.share });
  });

  /** Questions not yet linked to any outcome — the orphaned-question view. */
  app.get("/api/v1/schools/:schoolId/knowledge/orphaned-questions", async (req, reply) => {
    const { schoolId } = req.params as { schoolId: string };
    await requireTeacherOf(req, schoolId);
    const questions = await ctx.knowledge.needsLinking(schoolId);
    return reply.send(questions.map((q) => ({ id: q.id, text: q.text })));
  });

  // ---- Mapping overrides (full TCH-3, FR-SKG-004) ----

  app.get("/api/v1/schools/:schoolId/content/:itemId/mappings", async (req, reply) => {
    const { schoolId, itemId } = req.params as { schoolId: string; itemId: string };
    await requireTeacherOf(req, schoolId);
    await requireItemIn(schoolId, itemId);
    const views = await ctx.mapping.mappingViews(itemId);
    return reply.send(views.map((v) => ({
      mappingId: v.mapping.id,
      nodeId: v.mapping.nodeId,
      overriddenFromNodeId: v.mapping.overriddenFromNodeId ?? null,
      source: v.mapping.source,
      flags: v.mapping.flags,
      chain: v.chain.map((n) => n.label),
    })));
  });

  app.post("/api/v1/schools/:schoolId/mappings/:mappingId/override", async (req, reply) => {
    const { schoolId, mappingId } = req.params as { schoolId: string; mappingId: string };
    const auth = await requireTeacherOf(req, schoolId);
    const mapping = await ctx.skillGraphStore.getMapping(mappingId);
    if (!mapping) throw new NotFoundError("Mapping not found.");
    const item = await ctx.contentStore.getContentItem(mapping.contentItemId);
    if (!item || item.schoolId !== schoolId) throw new NotFoundError("Mapping not found in this school.");
    const { newNodeId, remapHistorical } = req.body as { newNodeId: string; remapHistorical?: boolean };
    // With historical mastery on the old node, the service returns the
    // remap-historical decision prompt instead of silently applying (FR-SKG-004).
    const result = await ctx.mapping.overrideMapping(mappingId, newNodeId, auth.user.id, { remapHistorical });
    return reply.send(result);
  });

  app.post("/api/v1/schools/:schoolId/mappings/bulk-override", async (req, reply) => {
    const { schoolId } = req.params as { schoolId: string };
    const auth = await requireTeacherOf(req, schoolId);
    const { mappingIds, newNodeId, confirm } = req.body as { mappingIds: string[]; newNodeId: string; confirm?: boolean };
    for (const id of mappingIds ?? []) {
      const mapping = await ctx.skillGraphStore.getMapping(id);
      const item = mapping ? await ctx.contentStore.getContentItem(mapping.contentItemId) : undefined;
      if (!item || item.schoolId !== schoolId) throw new NotFoundError("Mapping not found in this school.");
    }
    // Without confirm:true the service answers with the single-confirmation prompt.
    const result = await ctx.mapping.bulkOverride(mappingIds ?? [], newNodeId, auth.user.id, { confirm });
    return reply.send(result);
  });

  // ---- Growth report (TCH-15, FR-REP-001) ----

  app.get("/api/v1/schools/:schoolId/classes/:classId/growth-report", async (req, reply) => {
    const { schoolId, classId } = req.params as { schoolId: string; classId: string };
    const auth = await requireTeacherOf(req, schoolId);
    const report = await ctx.reporting.teacherGrowthReport(auth.user.id, schoolId, classId);
    const nodeLabels = await nodeLabelMap(schoolId);
    return reply.send({
      classId: report.classId,
      className: report.className,
      limited: report.limited,
      note: report.note,
      growth: report.growth.map((g) => ({ ...g, nodeLabel: nodeLabels[g.nodeId] ?? g.nodeId })),
    });
  });

  // ---- Behavioural + co-curricular records (TCH-16, FR-BSS / FR-CAP-002) ----
  // Behavioural notes are teacher-authored with NO score field anywhere; the
  // service enforces the four fixed categories, the consent gate and per-persona
  // visibility. Co-curricular is a deliberately separate, simpler structure.

  app.get("/api/v1/schools/:schoolId/students/:studentId/records", async (req, reply) => {
    const { schoolId, studentId } = req.params as { schoolId: string; studentId: string };
    const auth = await requireTeacherOf(req, schoolId);
    const behavioural = await ctx.behavioural.observationsFor(auth.user.id, schoolId, studentId);
    const coCurricular = await ctx.reportingStore.listCoCurricularByStudent(studentId);
    return reply.send({
      behavioural: {
        visibility: behavioural.visibility,
        notes: behavioural.notes.map((n) => ({ id: n.id, category: n.category, note: n.note, createdAt: n.createdAt })),
      },
      coCurricular: coCurricular.map((c) => ({ id: c.id, domain: c.domain, skill: c.skill, level: c.level, createdAt: c.createdAt })),
    });
  });

  app.post("/api/v1/schools/:schoolId/students/:studentId/behavioural", async (req, reply) => {
    const { schoolId, studentId } = req.params as { schoolId: string; studentId: string };
    const auth = await requireTeacherOf(req, schoolId);
    const { category, note } = req.body as { category: string; note: string };
    const observation = await ctx.behavioural.recordObservation(auth.user.id, schoolId, { studentId, category: category as never, note });
    return reply.status(201).send({ id: observation.id, category: observation.category });
  });

  app.post("/api/v1/schools/:schoolId/students/:studentId/cocurricular", async (req, reply) => {
    const { schoolId, studentId } = req.params as { schoolId: string; studentId: string };
    const auth = await requireTeacherOf(req, schoolId);
    const { domain, skill, level } = req.body as { domain: string; skill: string; level: string };
    const record = await ctx.coCurricular.recordCapability(auth.user.id, schoolId, { studentId, domain: domain as never, skill, level });
    return reply.status(201).send({ id: record.id, domain: record.domain });
  });

  // ---- Assign work to a student (feeds the Student workspace, FR-STU-001) ----
  app.post("/api/v1/schools/:schoolId/tasks", async (req, reply) => {
    const { schoolId } = req.params as { schoolId: string };
    const auth = await requireTeacherOf(req, schoolId);
    const body = req.body as {
      studentId: string; classId?: string | null; type: "homework" | "practice" | "assessment";
      title: string; nodeId?: string | null; assessmentId?: string | null; dueDate: string;
    };
    const student = await ctx.store.getUser(body.studentId);
    if (!student || student.schoolId !== schoolId) throw new NotFoundError("Student not found in this school.");
    const task = await ctx.studentWorkspace.assignTask(auth.user.id, schoolId, body);
    return reply.status(201).send({ id: task.id, title: task.title, type: task.type, dueDate: task.dueDate });
  });

  // ---- Teacher calendar (TCH-18) ----

  app.get("/api/v1/schools/:schoolId/calendar", async (req, reply) => {
    const { schoolId } = req.params as { schoolId: string };
    await requireTeacherOf(req, schoolId);
    const events = await ctx.workspaceStore.listEventsBySchool(schoolId);
    return reply.send(events.map((e) => ({
      id: e.id, title: e.title, type: e.type, eventDate: e.eventDate,
      yearGroup: e.yearGroup, changed: e.changed,
    })));
  });

  app.post("/api/v1/schools/:schoolId/calendar", async (req, reply) => {
    const { schoolId } = req.params as { schoolId: string };
    const auth = await requireTeacherOf(req, schoolId);
    const { title, type, eventDate, yearGroup } = req.body as { title: string; type: string; eventDate: string; yearGroup?: string | null };
    const event = await ctx.studentWorkspace.createEvent(auth.user.id, schoolId, { title, type: type as never, eventDate, yearGroup: yearGroup ?? null });
    return reply.status(201).send({ id: event.id, title: event.title, eventDate: event.eventDate });
  });

  app.post("/api/v1/schools/:schoolId/calendar/:eventId/reschedule", async (req, reply) => {
    const { schoolId, eventId } = req.params as { schoolId: string; eventId: string };
    const auth = await requireTeacherOf(req, schoolId);
    const { newDate } = req.body as { newDate: string };
    const event = await ctx.studentWorkspace.rescheduleEvent(auth.user.id, schoolId, eventId, newDate);
    return reply.send({ id: event.id, eventDate: event.eventDate, changed: event.changed });
  });
}
