import type { FastifyInstance, FastifyRequest } from "fastify";
import { AuthError, NotFoundError } from "../domain/errors";
import type { AppContext } from "../context";
import type { ContentItem } from "../domain/content";
import type { Assessment } from "../domain/assessment";

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
      questions: questions
        .sort((x, y) => x.order - y.order)
        .map((q) => ({
          id: q.id, order: q.order, type: q.type, prompt: q.prompt, options: q.options,
          modelAnswer: q.modelAnswer, rubric: q.rubric, difficulty: q.difficulty,
          reviewed: q.reviewed, groundingSources: q.groundingContentIds.map((gid) => titles.get(gid) ?? gid),
        })),
    });
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
  app.get("/api/v1/schools/:schoolId/teacher/classes", async (req, reply) => {
    const { schoolId } = req.params as { schoolId: string };
    await requireTeacherOf(req, schoolId);
    const classes = await ctx.store.listClassesBySchool(schoolId);
    return reply.send(classes.map((c) => ({ id: c.id, name: c.name, yearGroup: c.yearGroup ?? null })));
  });

  app.get("/api/v1/schools/:schoolId/classes/:classId/heatmap", async (req, reply) => {
    const { schoolId, classId } = req.params as { schoolId: string; classId: string };
    await requireTeacherOf(req, schoolId);
    const klass = (await ctx.store.listClassesBySchool(schoolId)).find((c) => c.id === classId);
    if (!klass) throw new NotFoundError("Class not found in this school.");
    const heatmap = await ctx.dashboard.heatmap(schoolId, classId);

    // Resolve display labels. Synthetic students hold no PII by design — they
    // render as positional labels, never fabricated names.
    const studentLabels: Record<string, string> = {};
    let position = 0;
    for (const studentId of heatmap.students) {
      position += 1;
      const pii = await ctx.store.getPersonalData(studentId);
      studentLabels[studentId] = pii
        ? `${pii.firstName} ${pii.lastName}`
        : `Student ${String(position).padStart(2, "0")}`;
    }
    const version = await signedVersion(schoolId);
    const nodeLabels: Record<string, string> = {};
    if (version) {
      for (const n of await ctx.skillGraphStore.listNodes(version.id)) nodeLabels[n.id] = n.label;
    }

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
}
