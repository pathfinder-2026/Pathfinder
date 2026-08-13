import Fastify, { type FastifyInstance } from "fastify";
import {
  AuthError,
  ConfirmationRequiredError,
  ConflictError,
  DomainError,
  NotFoundError,
  ServiceUnavailableError,
  ValidationError,
} from "../domain/errors";
import { buildContext, type AppContext, type BuildContextOptions } from "../context";
import { registerPreview } from "./preview";
import { registerAdminApi } from "./adminApi";
import { registerTeacherApi } from "./teacherApi";
import { registerStudentApi } from "./studentApi";
import { registerParentApi } from "./parentApi";
import { registerPrincipalApi } from "./principalApi";

/**
 * Minimal HTTP surface for Milestone 0. It exposes just enough of the core
 * loop to satisfy the definition of done end-to-end (create a school, invite a
 * Teacher through the notification service, accept, and log in as that
 * Teacher). Full REST/UI arrives with later milestones.
 */
export function buildApp(options: BuildContextOptions = {}, ctx?: AppContext): FastifyInstance {
  const context = ctx ?? buildContext(options);
  const app = Fastify({ logger: false });

  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ConfirmationRequiredError) {
      return reply
        .status(409)
        .send({ code: error.code, message: error.message, confirmationToken: error.confirmationToken });
    }
    if (error instanceof ValidationError) {
      return reply.status(400).send({ code: error.code, message: error.message });
    }
    if (error instanceof AuthError) {
      return reply.status(401).send({ code: error.code, message: error.message });
    }
    if (error instanceof NotFoundError) {
      return reply.status(404).send({ code: error.code, message: error.message });
    }
    if (error instanceof ConflictError) {
      return reply.status(409).send({ code: error.code, message: error.message });
    }
    // A down dependency (IdP outage, AI provider unavailable) is a 503 —
    // "try again", never a caller mistake.
    if (error instanceof ServiceUnavailableError) {
      return reply.status(503).send({ code: error.code, message: error.message });
    }
    if (error instanceof DomainError) {
      return reply.status(400).send({ code: error.code, message: error.message });
    }
    // Fastify's own client errors (bad JSON, empty JSON body, oversized payload…)
    // carry their proper 4xx status — pass them through rather than masking as 500.
    const fastifyError = error as { statusCode?: unknown; code?: string; message?: string };
    if (typeof fastifyError.statusCode === "number" && fastifyError.statusCode >= 400 && fastifyError.statusCode < 500) {
      return reply.status(fastifyError.statusCode).send({ code: fastifyError.code ?? "BAD_REQUEST", message: fastifyError.message ?? "Bad request" });
    }
    // An unexpected error must be visible to operators, never silently a 500.
    // eslint-disable-next-line no-console
    console.error("Unhandled API error:", error);
    return reply.status(500).send({ code: "INTERNAL", message: "Internal error" });
  });

  app.get("/health", async () => ({ status: "ok" }));

  app.post("/schools", async (req, reply) => {
    const result = await context.schools.createSchool(req.body as never);
    return reply.status(201).send(result);
  });

  app.post("/schools/:schoolId/invites/teacher", async (req, reply) => {
    const { schoolId } = req.params as { schoolId: string };
    const result = await context.invites.inviteTeacher(schoolId, req.body as never);
    // Never return the raw email; the caller already has it.
    return reply.status(201).send({
      inviteId: result.invite.id,
      token: result.invite.token,
      userId: result.user.id,
      notificationId: result.notificationId,
    });
  });

  app.post("/invites/accept", async (req, reply) => {
    const { token, password } = req.body as { token: string; password: string };
    const result = await context.auth.acceptInvite(token, password);
    return reply.status(200).send({ userId: result.user.id, status: result.user.status });
  });

  app.post("/auth/login", async (req, reply) => {
    const { email, password } = req.body as { email: string; password: string };
    const result = await context.auth.login(email, password);
    return reply.status(200).send(result);
  });

  app.get("/me", async (req, reply) => {
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    const auth = await context.auth.authorize(token);
    return reply.status(200).send({
      userId: auth.user.id,
      schoolId: auth.user.schoolId,
      roles: auth.roles,
      memberships: auth.memberships.map((m) => ({ role: m.role, classId: m.classId })),
    });
  });

  // Production Admin onboarding API (FR-ADM/FR-ONB), consumed by apps/app.
  registerAdminApi(app, context);

  // Production Teacher workflow API (TCH-*), consumed by apps/app.
  registerTeacherApi(app, context);

  // Production Student workspace API (STU-1..5, safety-critical), consumed by apps/app.
  registerStudentApi(app, context);

  // Production Parent API (PAR-1..5, verification-before-data), consumed by apps/app.
  registerParentApi(app, context);

  // Production Principal API (PRB-1..5; transcripts unreachable by construction).
  registerPrincipalApi(app, context);

  // Preview/validation console API (M0–M5a). Routes register immediately; the
  // demo world bootstraps lazily on first /api call, so tests are unaffected.
  registerPreview(app, context);

  return app;
}
