import type { FastifyInstance, FastifyRequest } from "fastify";
import { AuthError, NotFoundError } from "../domain/errors";
import type { AppContext } from "../context";

/**
 * Production HTTP surface for the Parent persona (PAR-1..5). Mounted under
 * /api/v1 next to the other persona surfaces.
 *
 * Non-negotiables (M8): verification-before-data is ABSOLUTE — the domain
 * denies everything (dashboard, calendar, report) until an Admin verifies the
 * link, and a parent only ever sees their own child, never merged across
 * children. Summaries are plain-language and never diagnostic (domain-guarded).
 */
export function registerParentApi(app: FastifyInstance, ctx: AppContext): void {
  const bearer = (req: FastifyRequest): string => {
    const header = req.headers.authorization ?? "";
    return header.startsWith("Bearer ") ? header.slice(7) : "";
  };

  /** Resolve the caller and assert they hold the Parent role in `schoolId`. */
  const requireParentOf = async (req: FastifyRequest, schoolId: string) => {
    const auth = await ctx.auth.authorize(bearer(req));
    if (!auth.roles.includes("parent")) throw new AuthError("Parent role required.", "PARENT_ROLE_REQUIRED");
    if (auth.user.schoolId !== schoolId) throw new AuthError("Not a member of this school.");
    return auth;
  };

  // ---- PAR-1: my verified children (unverified links simply don't appear) ----
  app.get("/api/v1/schools/:schoolId/parent/children", async (req, reply) => {
    const { schoolId } = req.params as { schoolId: string };
    const auth = await requireParentOf(req, schoolId);
    return reply.send(await ctx.parents.verifiedChildren(auth.user.id));
  });

  // ---- PAR-2: plain-language dashboard for ONE verified child ----
  app.get("/api/v1/schools/:schoolId/parent/children/:studentId/dashboard", async (req, reply) => {
    const { schoolId, studentId } = req.params as { schoolId: string; studentId: string };
    const auth = await requireParentOf(req, schoolId);
    // Verification-before-data + no-cross-student both enforced in the domain (AuthError -> 401).
    return reply.send(await ctx.parents.dashboardFor(auth.user.id, studentId));
  });

  // ---- PAR-3: the child's calendar (per-child, year-group-scoped) ----
  app.get("/api/v1/schools/:schoolId/parent/children/:studentId/calendar", async (req, reply) => {
    const { schoolId, studentId } = req.params as { schoolId: string; studentId: string };
    const auth = await requireParentOf(req, schoolId);
    return reply.send(await ctx.parents.calendarFor(auth.user.id, studentId));
  });

  // ---- PAR-4: my weekly digests (the single consolidated cadence) ----
  // The in-memory channel is the in-app notification record in both backends;
  // safeguarding items never travel this path (they escalate immediately).
  app.get("/api/v1/schools/:schoolId/parent/digests", async (req, reply) => {
    const { schoolId } = req.params as { schoolId: string };
    const auth = await requireParentOf(req, schoolId);
    const digests = ctx.notificationChannel.delivered
      .filter((m) => m.type === "parent.digest" && m.to === auth.user.id)
      .map((m) => ({ subject: m.subject, body: m.body, at: m.at }));
    return reply.send(digests);
  });

  // ---- PAR-5: the child's term report (empty sections omitted gracefully) ----
  app.get("/api/v1/schools/:schoolId/parent/children/:studentId/report", async (req, reply) => {
    const { schoolId, studentId } = req.params as { schoolId: string; studentId: string };
    const auth = await requireParentOf(req, schoolId);
    return reply.send(await ctx.reporting.parentReport(auth.user.id, schoolId, studentId));
  });

  // ---- Admin side of PAR-1: link + verify (the school vouches for the relationship) ----

  const requireAdminOf = async (req: FastifyRequest, schoolId: string) => {
    const auth = await ctx.auth.authorize(bearer(req));
    if (!auth.roles.includes("admin")) throw new AuthError("Administrator role required.");
    if (auth.user.schoolId !== schoolId) throw new AuthError("Not an administrator of this school.");
    return auth;
  };

  app.get("/api/v1/schools/:schoolId/parent-links", async (req, reply) => {
    const { schoolId } = req.params as { schoolId: string };
    await requireAdminOf(req, schoolId);
    const links = await ctx.parentStore.listLinksBySchool(schoolId);
    const rows = await Promise.all(links.map(async (l) => {
      const parent = await ctx.store.getPersonalData(l.parentId);
      const child = await ctx.store.getPersonalData(l.studentId);
      return {
        id: l.id,
        parentLabel: parent ? `${parent.firstName} ${parent.lastName}` : l.parentId,
        childLabel: child ? `${child.firstName} ${child.lastName}` : l.studentId,
        relationship: l.relationship,
        verified: l.verified,
      };
    }));
    return reply.send(rows);
  });

  app.post("/api/v1/schools/:schoolId/parent-links", async (req, reply) => {
    const { schoolId } = req.params as { schoolId: string };
    const auth = await requireAdminOf(req, schoolId);
    const { parentId, studentId, relationship } = req.body as { parentId: string; studentId: string; relationship: string };
    const link = await ctx.parents.linkChild(auth.user.id, schoolId, { parentId, studentId, relationship: relationship ?? "parent" });
    return reply.status(201).send({ id: link.id, verified: link.verified });
  });

  app.post("/api/v1/schools/:schoolId/parent-links/:linkId/verify", async (req, reply) => {
    const { schoolId, linkId } = req.params as { schoolId: string; linkId: string };
    const auth = await requireAdminOf(req, schoolId);
    const existing = await ctx.parentStore.getLink(linkId);
    if (!existing || existing.schoolId !== schoolId) throw new NotFoundError("Link not found.");
    const link = await ctx.parents.verifyLink(auth.user.id, schoolId, linkId);
    return reply.send({ id: link.id, verified: link.verified });
  });

  /** Trigger the weekly digest run (a scheduler's job in production). */
  app.post("/api/v1/schools/:schoolId/parent-digest/run", async (req, reply) => {
    const { schoolId } = req.params as { schoolId: string };
    await requireAdminOf(req, schoolId);
    return reply.send(await ctx.parents.runWeeklyDigest(schoolId));
  });
}
