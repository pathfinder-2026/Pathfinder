import type { FastifyInstance, FastifyRequest } from "fastify";
import { AuthError, NotFoundError } from "../domain/errors";
import type { AppContext } from "../context";
import type { StudentTask } from "../domain/studentWorkspace";
import type { AssessmentAttempt } from "../domain/assessment";

/**
 * Production HTTP surface for the Student thread (STU-1..4) — the SAFETY-CRITICAL
 * persona. Mounted under /api/v1 next to the Admin and Teacher surfaces.
 *
 * Non-negotiables enforced here and in the domain beneath:
 *   - Students only ever reach PUBLISHED assessments (permission layer, logged).
 *   - Ask-for-Help lockout is task-state-based (assessment task / in-progress
 *     attempt) and safeguarding-gated — all decided in the domain, never here.
 *   - Model answers and rubrics are NEVER serialised to a student.
 *   - A student only sees their own tasks/attempts (ownership checks per route).
 */
export function registerStudentApi(app: FastifyInstance, ctx: AppContext): void {
  const bearer = (req: FastifyRequest): string => {
    const header = req.headers.authorization ?? "";
    return header.startsWith("Bearer ") ? header.slice(7) : "";
  };

  /** Resolve the caller and assert they hold the Student role in `schoolId`. */
  const requireStudentOf = async (req: FastifyRequest, schoolId: string) => {
    const auth = await ctx.auth.authorize(bearer(req));
    if (!auth.roles.includes("student")) throw new AuthError("Student role required.", "STUDENT_ROLE_REQUIRED");
    if (auth.user.schoolId !== schoolId) throw new AuthError("Not a member of this school.");
    return auth;
  };

  /** Fetch a task and assert it belongs to this student. */
  const requireOwnTask = async (studentId: string, taskId: string): Promise<StudentTask> => {
    const task = await ctx.workspaceStore.getTask(taskId);
    if (!task || task.studentId !== studentId) throw new NotFoundError("Task not found.");
    return task;
  };

  /** Fetch an attempt and assert it belongs to this student. */
  const requireOwnAttempt = async (studentId: string, attemptId: string): Promise<AssessmentAttempt> => {
    const attempt = await ctx.assessmentStore.getAttempt(attemptId);
    if (!attempt || attempt.studentId !== studentId) throw new NotFoundError("Attempt not found.");
    return attempt;
  };

  // ---- STU-1: workspace (today / this week, calm overdue) ----
  app.get("/api/v1/schools/:schoolId/student/workspace", async (req, reply) => {
    const { schoolId } = req.params as { schoolId: string };
    const auth = await requireStudentOf(req, schoolId);
    return reply.send(await ctx.studentWorkspace.workspaceFor(auth.user.id));
  });

  // ---- STU-2: task detail + Ask for Help ----
  app.get("/api/v1/schools/:schoolId/student/tasks/:taskId", async (req, reply) => {
    const { schoolId, taskId } = req.params as { schoolId: string; taskId: string };
    const auth = await requireStudentOf(req, schoolId);
    const task = await requireOwnTask(auth.user.id, taskId);
    return reply.send({
      id: task.id, type: task.type, title: task.title, dueDate: task.dueDate,
      status: task.status, assessmentId: task.assessmentId,
    });
  });

  app.post("/api/v1/schools/:schoolId/student/tasks/:taskId/complete", async (req, reply) => {
    const { schoolId, taskId } = req.params as { schoolId: string; taskId: string };
    const auth = await requireStudentOf(req, schoolId);
    await requireOwnTask(auth.user.id, taskId);
    const task = await ctx.studentWorkspace.completeTask(auth.user.id, taskId);
    return reply.send({ id: task.id, status: task.status });
  });

  app.post("/api/v1/schools/:schoolId/student/tasks/:taskId/help", async (req, reply) => {
    const { schoolId, taskId } = req.params as { schoolId: string; taskId: string };
    const auth = await requireStudentOf(req, schoolId);
    await requireOwnTask(auth.user.id, taskId);
    const { message } = req.body as { message: string };
    // All safety decisions (safeguarding gate, task-state lockout, deterministic
    // classifiers, grounded-hint-never-answer) live in the domain service.
    const result = await ctx.askForHelp.ask(auth.user.id, taskId, message ?? "");
    return reply.send(result);
  });

  // ---- STU-3: calendar (permitted events only; changed flag) ----
  app.get("/api/v1/schools/:schoolId/student/calendar", async (req, reply) => {
    const { schoolId } = req.params as { schoolId: string };
    const auth = await requireStudentOf(req, schoolId);
    return reply.send(await ctx.studentWorkspace.calendarFor(auth.user.id));
  });

  // ---- STU-4: assessment attempt with work preservation (FR-ASM-004) ----

  /**
   * The student view of a PUBLISHED assessment. Access is enforced at the
   * permission layer (denied + logged when unpublished). Model answers and
   * rubrics are deliberately never included.
   */
  app.get("/api/v1/schools/:schoolId/student/assessments/:assessmentId", async (req, reply) => {
    const { schoolId, assessmentId } = req.params as { schoolId: string; assessmentId: string };
    const auth = await requireStudentOf(req, schoolId);
    const a = await ctx.assessment.getForStudent(assessmentId, auth.user.id);
    if (a.schoolId !== schoolId) throw new NotFoundError("Assessment not found.");
    const questions = await ctx.assessmentStore.listQuestionsByAssessment(assessmentId);
    return reply.send({
      id: a.id,
      title: a.title,
      questions: questions
        .sort((x, y) => x.order - y.order)
        .map((q) => ({ id: q.id, order: q.order, type: q.type, prompt: q.prompt, options: q.options })),
    });
  });

  app.post("/api/v1/schools/:schoolId/student/assessments/:assessmentId/attempts", async (req, reply) => {
    const { schoolId, assessmentId } = req.params as { schoolId: string; assessmentId: string };
    const auth = await requireStudentOf(req, schoolId);
    const attempt = await ctx.assessment.startAttempt(assessmentId, auth.user.id);
    return reply.status(201).send({ id: attempt.id, status: attempt.status, savedAnswers: attempt.savedAnswers });
  });

  app.post("/api/v1/schools/:schoolId/student/attempts/:attemptId/save", async (req, reply) => {
    const { schoolId, attemptId } = req.params as { schoolId: string; attemptId: string };
    const auth = await requireStudentOf(req, schoolId);
    await requireOwnAttempt(auth.user.id, attemptId);
    const { answers } = req.body as { answers: Record<string, string> };
    const attempt = await ctx.assessment.saveProgress(attemptId, answers ?? {});
    return reply.send({ lastSavedAt: attempt.lastSavedAt });
  });

  app.post("/api/v1/schools/:schoolId/student/attempts/:attemptId/interrupted", async (req, reply) => {
    const { schoolId, attemptId } = req.params as { schoolId: string; attemptId: string };
    const auth = await requireStudentOf(req, schoolId);
    await requireOwnAttempt(auth.user.id, attemptId);
    await ctx.assessment.markInterrupted(attemptId);
    return reply.send({ ok: true });
  });

  /** Resume after connectivity loss: work is preserved to the last save point. */
  app.get("/api/v1/schools/:schoolId/student/attempts/:attemptId/resume", async (req, reply) => {
    const { schoolId, attemptId } = req.params as { schoolId: string; attemptId: string };
    const auth = await requireStudentOf(req, schoolId);
    await requireOwnAttempt(auth.user.id, attemptId);
    return reply.send(await ctx.assessment.resume(attemptId));
  });

  app.post("/api/v1/schools/:schoolId/student/attempts/:attemptId/submit", async (req, reply) => {
    const { schoolId, attemptId } = req.params as { schoolId: string; attemptId: string };
    const auth = await requireStudentOf(req, schoolId);
    const { answers } = (req.body ?? {}) as { answers?: Record<string, string> };
    const attempt = await ctx.assessment.submitAttempt(attemptId, auth.user.id, answers ?? {});
    return reply.send({ id: attempt.id, status: attempt.status });
  });

  // ---- STU-5: peer tests — deliveries, review submission, softened signal ----
  // The student only ever sees the softened, non-ranked signal, and ONLY once
  // the teacher explicitly published (withheld default; no timer). Peer reviews
  // go to teacher moderation before the reviewed student sees anything.

  /** A peer test placed with this student, with their cohort membership asserted. */
  const requirePlacedPeerTest = async (studentId: string, peerTestId: string) => {
    const test = await ctx.peerStore.getPeerTest(peerTestId);
    if (!test || !test.cohort.includes(studentId)) throw new NotFoundError("Peer test not found.");
    return test;
  };

  app.get("/api/v1/schools/:schoolId/student/peer-tests", async (req, reply) => {
    const { schoolId } = req.params as { schoolId: string };
    const auth = await requireStudentOf(req, schoolId);
    return reply.send(await ctx.peerTests.deliveriesForStudent(auth.user.id));
  });

  app.get("/api/v1/schools/:schoolId/student/peer-tests/:peerTestId", async (req, reply) => {
    const { schoolId, peerTestId } = req.params as { schoolId: string; peerTestId: string };
    const auth = await requireStudentOf(req, schoolId);
    const test = await requirePlacedPeerTest(auth.user.id, peerTestId);
    const signal = await ctx.peerTests.studentSignal(peerTestId, auth.user.id);
    // Cohort peers for the review target picker (labels only, never emails).
    const peers: { id: string; label: string }[] = [];
    let position = 0;
    for (const sid of test.cohort) {
      position += 1;
      if (sid === auth.user.id) continue;
      const pii = await ctx.store.getPersonalData(sid);
      peers.push({ id: sid, label: pii ? `${pii.firstName} ${pii.lastName}` : `Student ${String(position).padStart(2, "0")}` });
    }
    return reply.send({
      id: test.id,
      title: test.title,
      questionCount: test.questionCount,
      rubric: test.rubric,
      status: test.status,
      peers,
      // Softened + non-ranked; withheld/suppressed states carry their honest message.
      signal,
    });
  });

  app.post("/api/v1/schools/:schoolId/student/peer-tests/:peerTestId/reviews", async (req, reply) => {
    const { schoolId, peerTestId } = req.params as { schoolId: string; peerTestId: string };
    const auth = await requireStudentOf(req, schoolId);
    const test = await requirePlacedPeerTest(auth.user.id, peerTestId);
    const { targetStudentId, text } = req.body as { targetStudentId: string; text: string };
    if (!test.cohort.includes(targetStudentId)) throw new NotFoundError("That student is not in this peer test.");
    await ctx.peerReviews.submitReview(auth.user.id, schoolId, peerTestId, targetStudentId, text ?? "");
    // The anonymity-risk flag is teacher-facing; the student just gets an ack.
    return reply.status(201).send({ ok: true, message: "Sent to your teacher for review before your classmate sees it." });
  });

  /** Approved, anonymised reviews about MY work — or the neutral no-feedback state. */
  app.get("/api/v1/schools/:schoolId/student/peer-feedback", async (req, reply) => {
    const { schoolId } = req.params as { schoolId: string };
    const auth = await requireStudentOf(req, schoolId);
    return reply.send(await ctx.peerReviews.feedbackForStudent(auth.user.id));
  });
}
