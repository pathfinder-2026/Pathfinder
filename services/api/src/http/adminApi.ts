import type { FastifyInstance, FastifyRequest } from "fastify";
import { AuthError } from "../domain/errors";
import type { AppContext } from "../context";
import type { Role } from "../domain/types";
import { ADMIN_STEPS, type AdminStep } from "../services/onboardingService";

/**
 * Production HTTP surface for the School-Admin onboarding workflow (FR-ADM-001/002/007,
 * FR-ONB-001/002), consumed by the production web app (apps/app). Mounted under
 * /api/v1 so it never collides with the M0 core-loop routes or the preview console.
 *
 * Every route runs the already-tested domain services; this layer only does HTTP
 * plumbing + session auth. Errors flow through buildApp's shared error handler.
 */
export function registerAdminApi(app: FastifyInstance, ctx: AppContext): void {
  const bearer = (req: FastifyRequest): string => {
    const header = req.headers.authorization ?? "";
    return header.startsWith("Bearer ") ? header.slice(7) : "";
  };

  /** Resolve the caller; throws AuthError (-> 401) when the session is invalid. */
  const requireUser = (req: FastifyRequest) => ctx.auth.authorize(bearer(req));

  /** Resolve the caller and assert they administer `schoolId`. */
  const requireAdminOf = async (req: FastifyRequest, schoolId: string) => {
    const auth = await requireUser(req);
    if (!auth.roles.includes("admin")) throw new AuthError("Administrator role required.");
    if (auth.user.schoolId !== schoolId) throw new AuthError("Not an administrator of this school.");
    return auth;
  };

  const counts = async (schoolId: string) => {
    const memberships = await ctx.store.listMembershipsBySchool(schoolId);
    const classes = await ctx.store.listClassesBySchool(schoolId);
    const by = (r: Role) => memberships.filter((m) => m.role === r).length;
    return { teachers: by("teacher"), students: by("student"), parents: by("parent"), principals: by("principal"), classes: classes.length };
  };

  // ---- Sign in an existing user; resolve their school context ----
  app.post("/api/v1/auth/login", async (req, reply) => {
    const { email, password } = req.body as { email: string; password: string };
    const session = await ctx.auth.login(email, password);
    const auth = await ctx.auth.authorize(session.token);
    const campuses = await ctx.store.listCampusesBySchool(auth.user.schoolId);
    return reply.send({
      token: session.token,
      schoolId: auth.user.schoolId,
      campusId: campuses[0]?.id ?? null,
      roles: auth.roles,
    });
  });

  // ---- Onboarding: create the school + founding Admin, issue a session ----
  app.post("/api/v1/onboarding/start", async (req, reply) => {
    const body = req.body as {
      school: { name: string; campusName: string; academicYear: { name: string; terms: { name: string; startDate: string; endDate: string }[] } };
      admin: { email: string; firstName: string; lastName: string; password: string };
      confirmDuplicate?: boolean;
    };
    const created = await ctx.schools.createSchool({ ...body.school, confirmDuplicate: body.confirmDuplicate });
    const { user } = await ctx.accounts.createAccount({
      schoolId: created.school.id,
      role: "admin",
      email: body.admin.email,
      firstName: body.admin.firstName,
      lastName: body.admin.lastName,
      campusId: created.campus.id,
    });
    await ctx.auth.setInitialPassword(user.id, body.admin.password);
    const session = await ctx.auth.login(body.admin.email, body.admin.password);
    await ctx.onboarding.completeStep(created.school.id, "create");
    return reply.status(201).send({
      token: session.token,
      schoolId: created.school.id,
      campusId: created.campus.id,
      adminId: user.id,
      schoolName: created.school.name,
    });
  });

  app.get("/api/v1/me", async (req, reply) => {
    const auth = await requireUser(req);
    const pii = await ctx.store.getPersonalData(auth.user.id);
    return reply.send({
      userId: auth.user.id,
      schoolId: auth.user.schoolId,
      roles: auth.roles,
      firstName: pii?.firstName ?? null,
      lastName: pii?.lastName ?? null,
    });
  });

  // ---- Onboarding state ----
  app.get("/api/v1/schools/:schoolId/onboarding", async (req, reply) => {
    const { schoolId } = req.params as { schoolId: string };
    await requireAdminOf(req, schoolId);
    const school = await ctx.store.getSchool(schoolId);
    const progress = await ctx.store.getOnboarding(schoolId);
    const currentStep = await ctx.onboarding.currentStep(schoolId);
    return reply.send({
      steps: ADMIN_STEPS,
      completedSteps: progress?.completedSteps ?? [],
      currentStep,
      workspaceEntered: progress?.workspaceEntered ?? false,
      school: { name: school?.name, configComplete: school?.configComplete ?? false },
      counts: await counts(schoolId),
    });
  });

  app.post("/api/v1/schools/:schoolId/onboarding/steps/:step/complete", async (req, reply) => {
    const { schoolId, step } = req.params as { schoolId: string; step: AdminStep };
    await requireAdminOf(req, schoolId);
    await ctx.onboarding.completeStep(schoolId, step);
    return reply.send({ ok: true, currentStep: await ctx.onboarding.currentStep(schoolId) });
  });

  app.post("/api/v1/schools/:schoolId/onboarding/enter-workspace", async (req, reply) => {
    const { schoolId } = req.params as { schoolId: string };
    await requireAdminOf(req, schoolId);
    const { confirmNoTeachers } = (req.body ?? {}) as { confirmNoTeachers?: boolean };
    const result = await ctx.onboarding.enterWorkspace(schoolId, { confirmNoTeachers });
    return reply.send(result);
  });

  // ---- Configure: classes (+ optional extra campus) ----
  app.get("/api/v1/schools/:schoolId/classes", async (req, reply) => {
    const { schoolId } = req.params as { schoolId: string };
    await requireAdminOf(req, schoolId);
    return reply.send(await ctx.store.listClassesBySchool(schoolId));
  });

  app.post("/api/v1/schools/:schoolId/classes", async (req, reply) => {
    const { schoolId } = req.params as { schoolId: string };
    const auth = await requireAdminOf(req, schoolId);
    const { campusId, name, yearGroup } = req.body as { campusId: string; name: string; yearGroup?: string | null };
    const klass = await ctx.schools.createClass(schoolId, campusId, name, auth.user.id, yearGroup ?? null);
    return reply.status(201).send(klass);
  });

  // ---- Invites (teachers / students / parents) ----
  app.get("/api/v1/schools/:schoolId/invites", async (req, reply) => {
    const { schoolId } = req.params as { schoolId: string };
    await requireAdminOf(req, schoolId);
    const invites = await ctx.store.listInvitesBySchool(schoolId);
    const rows = await Promise.all(
      invites.map(async (i) => {
        const pii = await ctx.store.getPersonalData(i.userId);
        return { id: i.id, role: i.role, status: i.status, firstName: pii?.firstName ?? null, lastName: pii?.lastName ?? null, email: pii?.email ?? null };
      }),
    );
    return reply.send(rows);
  });

  app.post("/api/v1/schools/:schoolId/invites", async (req, reply) => {
    const { schoolId } = req.params as { schoolId: string };
    const auth = await requireAdminOf(req, schoolId);
    const { role, email, firstName, lastName } = req.body as { role: Role; email: string; firstName: string; lastName: string };
    const result = await ctx.invites.invite(schoolId, role, { email, firstName, lastName }, auth.user.id);
    return reply.status(201).send({ inviteId: result.invite.id, userId: result.user.id, role: result.invite.role });
  });

  // ---- Accounts: assign roles + names (FR-ADM-002 / FR-ADM-007) ----
  app.get("/api/v1/schools/:schoolId/campuses", async (req, reply) => {
    const { schoolId } = req.params as { schoolId: string };
    await requireAdminOf(req, schoolId);
    const campuses = await ctx.store.listCampusesBySchool(schoolId);
    return reply.send(campuses.map((c) => ({ id: c.id, name: c.name })));
  });

  app.get("/api/v1/schools/:schoolId/accounts", async (req, reply) => {
    const { schoolId } = req.params as { schoolId: string };
    await requireAdminOf(req, schoolId);
    const memberships = await ctx.store.listMembershipsBySchool(schoolId);
    const rows = await Promise.all(
      memberships.map(async (m) => {
        const user = await ctx.store.getUser(m.userId);
        const pii = await ctx.store.getPersonalData(m.userId);
        return {
          membershipId: m.id, userId: m.userId, role: m.role, campusId: m.campusId,
          firstName: pii?.firstName ?? null, lastName: pii?.lastName ?? null, email: pii?.email ?? null,
          status: user?.status ?? "unknown",
        };
      }),
    );
    return reply.send(rows);
  });

  app.patch("/api/v1/schools/:schoolId/memberships/:membershipId/role", async (req, reply) => {
    const { schoolId, membershipId } = req.params as { schoolId: string; membershipId: string };
    const auth = await requireAdminOf(req, schoolId);
    const membership = await ctx.store.getMembership(membershipId);
    if (!membership || membership.schoolId !== schoolId) throw new AuthError("Membership not found in this school.");
    const { role, campusId } = req.body as { role: Role; campusId?: string | null };
    const updated = await ctx.accounts.changeMembership(membershipId, { role, campusId: campusId ?? membership.campusId }, auth.user.id);
    return reply.send({ membershipId: updated.id, role: updated.role, campusId: updated.campusId });
  });

  app.patch("/api/v1/schools/:schoolId/users/:userId/name", async (req, reply) => {
    const { schoolId, userId } = req.params as { schoolId: string; userId: string };
    const auth = await requireAdminOf(req, schoolId);
    const target = await ctx.store.getUser(userId);
    if (!target || target.schoolId !== schoolId) throw new AuthError("User not found in this school.");
    const { firstName, lastName } = req.body as { firstName: string; lastName: string };
    await ctx.accounts.updateName(userId, firstName, lastName, auth.user.id);
    return reply.send({ ok: true });
  });

  // ---- Configure operations: safeguarding contact (Ask-for-Help precondition) ----
  app.post("/api/v1/schools/:schoolId/safeguarding", async (req, reply) => {
    const { schoolId } = req.params as { schoolId: string };
    const auth = await requireAdminOf(req, schoolId);
    const body = req.body as { contactName: string; contactRole: string; slaHours: number; afterHoursPolicy: string };
    const config = await ctx.safeguarding.setConfig(auth.user.id, schoolId, body);
    return reply.status(201).send({ configured: true, contactName: config.contactName });
  });

  // ---- Branding (theming for the app; FR-WL) ----
  app.get("/api/v1/schools/:schoolId/branding", async (req, reply) => {
    const { schoolId } = req.params as { schoolId: string };
    await requireAdminOf(req, schoolId);
    return reply.send(await ctx.branding.forSurface(schoolId, "user"));
  });

  app.post("/api/v1/schools/:schoolId/branding", async (req, reply) => {
    const { schoolId } = req.params as { schoolId: string };
    const auth = await requireAdminOf(req, schoolId);
    const body = req.body as { primaryColor?: string; productName?: string; whiteLabelEnabled?: boolean };
    const config = await ctx.branding.configureBranding(schoolId, body, auth.user.id);
    return reply.status(200).send({ primaryColor: config.primaryColor, whiteLabelEnabled: config.whiteLabelEnabled });
  });

  // ---- Workspace summary ----
  app.get("/api/v1/schools/:schoolId/summary", async (req, reply) => {
    const { schoolId } = req.params as { schoolId: string };
    await requireAdminOf(req, schoolId);
    const school = await ctx.store.getSchool(schoolId);
    return reply.send({ schoolName: school?.name, configComplete: school?.configComplete ?? false, counts: await counts(schoolId) });
  });
}
