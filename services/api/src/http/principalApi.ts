import type { FastifyInstance, FastifyRequest } from "fastify";
import { AuthError } from "../domain/errors";
import type { AppContext } from "../context";

/**
 * Production HTTP surface for the Principal persona (PRB-1..5).
 *
 * HARD BOUNDARY (FR-PDB-005): Ask-for-Help transcripts are unreachable from
 * every route here — the service never reads the help store, the drill views
 * carry the structural `askForHelpExcluded` marker, and no transcript route is
 * mounted on this surface. Cross-campus comparison is not offered (FR-PDB-003);
 * teacher-to-teacher comparison appears only when school policy enables it
 * (FR-PDB-006, off by default).
 */
export function registerPrincipalApi(app: FastifyInstance, ctx: AppContext): void {
  const bearer = (req: FastifyRequest): string => {
    const header = req.headers.authorization ?? "";
    return header.startsWith("Bearer ") ? header.slice(7) : "";
  };

  /** Resolve the caller and assert they hold the Principal role in `schoolId`. */
  const requirePrincipalOf = async (req: FastifyRequest, schoolId: string) => {
    const auth = await ctx.auth.authorize(bearer(req));
    if (!auth.roles.includes("principal")) throw new AuthError("Principal role required.", "PRINCIPAL_ROLE_REQUIRED");
    if (auth.user.schoolId !== schoolId) throw new AuthError("Not a member of this school.");
    return auth;
  };

  // ---- PRB-1: per-teacher metrics + school-wide (comparison policy-gated) ----
  app.get("/api/v1/schools/:schoolId/principal/teacher-report", async (req, reply) => {
    const { schoolId } = req.params as { schoolId: string };
    const auth = await requirePrincipalOf(req, schoolId);
    return reply.send(await ctx.principalDashboard.teacherReport(auth.user.id, schoolId));
  });

  // ---- PRB-2: school-wide mastery / risk (outliers highlighted, never smoothed) ----
  app.get("/api/v1/schools/:schoolId/principal/mastery", async (req, reply) => {
    const { schoolId } = req.params as { schoolId: string };
    const auth = await requirePrincipalOf(req, schoolId);
    return reply.send(await ctx.principalDashboard.masteryOverview(auth.user.id, schoolId));
  });

  // ---- PRB-3: drill school -> class -> student (no transcript at any level) ----
  app.get("/api/v1/schools/:schoolId/principal/classes/:classId", async (req, reply) => {
    const { schoolId, classId } = req.params as { schoolId: string; classId: string };
    const auth = await requirePrincipalOf(req, schoolId);
    return reply.send(await ctx.principalDashboard.drillClass(auth.user.id, schoolId, classId));
  });

  app.get("/api/v1/schools/:schoolId/principal/students/:studentId", async (req, reply) => {
    const { schoolId, studentId } = req.params as { schoolId: string; studentId: string };
    const auth = await requirePrincipalOf(req, schoolId);
    return reply.send(await ctx.principalDashboard.drillStudent(auth.user.id, schoolId, studentId));
  });

  // ---- PRB-4: threshold alerts (seasonal-break suppression handled in the domain) ----
  app.get("/api/v1/schools/:schoolId/principal/alerts", async (req, reply) => {
    const { schoolId } = req.params as { schoolId: string };
    const auth = await requirePrincipalOf(req, schoolId);
    return reply.send(await ctx.principalDashboard.detectAlerts(auth.user.id, schoolId));
  });

  // ---- PRB-5: export — aggregates only, never any transcript content ----
  app.get("/api/v1/schools/:schoolId/principal/export", async (req, reply) => {
    const { schoolId } = req.params as { schoolId: string };
    const auth = await requirePrincipalOf(req, schoolId);
    return reply.send(await ctx.principalDashboard.exportReport(auth.user.id, schoolId));
  });

  // ---- FR-PDB-006: the comparison policy is an ADMIN decision ----
  app.post("/api/v1/schools/:schoolId/principal-policy", async (req, reply) => {
    const { schoolId } = req.params as { schoolId: string };
    const auth = await ctx.auth.authorize(bearer(req));
    if (!auth.roles.includes("admin")) throw new AuthError("Administrator role required.");
    if (auth.user.schoolId !== schoolId) throw new AuthError("Not an administrator of this school.");
    const { teacherComparisonEnabled } = req.body as { teacherComparisonEnabled: boolean };
    await ctx.principalDashboard.setPolicy(auth.user.id, schoolId, { teacherComparisonEnabled: !!teacherComparisonEnabled });
    return reply.send({ teacherComparisonEnabled: !!teacherComparisonEnabled });
  });
}
