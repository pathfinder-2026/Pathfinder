import { describe, expect, it } from "vitest";
import { buildApp } from "../src/http/app";
import { buildContext } from "../src/context";
import { FixedClock } from "../src/platform/clock";
import { newId } from "../src/platform/ids";

/**
 * #18 — the cross-teacher shared library, over HTTP.
 *
 * The domain has had share scopes since M1 (FR-CONT-004); what ships here is
 * the part teachers actually touch: browsing colleagues' shared material with
 * honest attribution, reusing it, and the ownership boundary — a shared item
 * is a colleague's to READ, never to manage. All sharing stays inside one
 * school; the two-school checks prove the walls hold.
 */

function makeApp() {
  const ctx = buildContext({ clock: new FixedClock() });
  return { ctx, app: buildApp({}, ctx) };
}

async function startSchool(app: ReturnType<typeof buildApp>) {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/onboarding/start",
    payload: {
      school: {
        name: `Shared Library High ${newId()}`,
        campusName: "Main",
        academicYear: { name: "2026", terms: [{ name: "T1", startDate: "2026-01-28", endDate: "2026-04-10" }] },
      },
      admin: { email: `admin-${newId()}@s.edu`, firstName: "Ada", lastName: "Admin", password: "password123" },
    },
  });
  expect(res.statusCode).toBe(201);
  const body = res.json() as { token: string; schoolId: string; campusId: string };
  return { ...body, auth: { authorization: `Bearer ${body.token}` } };
}

async function addTeacher(
  app: ReturnType<typeof buildApp>,
  schoolId: string,
  adminAuth: Record<string, string>,
  name: { firstName: string; lastName: string },
) {
  const email = `teacher-${newId()}@s.edu`;
  const invited = await app.inject({
    method: "POST", url: `/api/v1/schools/${schoolId}/invites`, headers: adminAuth,
    payload: { role: "teacher", email, ...name },
  });
  const rows = (await app.inject({ method: "GET", url: `/api/v1/schools/${schoolId}/invites`, headers: adminAuth })).json() as
    { id: string; inviteToken: string | null }[];
  const token = rows.find((r) => r.id === invited.json().inviteId)!.inviteToken!;
  const accepted = await app.inject({ method: "POST", url: "/api/v1/invites/accept", payload: { token, password: "password123" } });
  expect(accepted.statusCode).toBe(200);
  const auth = { authorization: `Bearer ${accepted.json().token as string}` };
  const me = (await app.inject({ method: "GET", url: "/api/v1/me", headers: auth })).json() as { userId: string };
  return { auth, userId: me.userId };
}

/** Put a teacher in a department via the domain (invites don't carry one). */
async function setDepartment(ctx: ReturnType<typeof buildContext>, userId: string, department: string) {
  const membership = (await ctx.store.listMembershipsByUser(userId)).find((m) => m.role === "teacher")!;
  await ctx.accounts.changeMembership(membership.id, { department });
}

async function signOffGraph(app: ReturnType<typeof buildApp>, schoolId: string, adminAuth: Record<string, string>) {
  const imported = await app.inject({ method: "POST", url: `/api/v1/schools/${schoolId}/skill-graph/import-seed`, headers: adminAuth });
  const versionId = imported.json().versionId as string;
  await app.inject({ method: "POST", url: `/api/v1/schools/${schoolId}/skill-graph/${versionId}/sign-off`, headers: adminAuth });
}

/** Upload → full pipeline → approved (+ optionally mapped and shared). */
async function approveItem(
  app: ReturnType<typeof buildApp>,
  schoolId: string,
  teacherAuth: Record<string, string>,
  opts: { title: string; nodeId?: string; share?: Record<string, unknown> },
) {
  const base = `/api/v1/schools/${schoolId}/content`;
  const up = await app.inject({
    method: "POST", url: base, headers: teacherAuth,
    payload: { title: opts.title, fileType: "pdf", text: `# Section one\nProse for ${opts.title}.\n# Section two\nMore prose.` },
  });
  expect(up.statusCode).toBe(201);
  const itemId = up.json().contentItemId as string;
  for (const step of ["ingest", "classify", "classification/approve", "attest", "approve"]) {
    const res = await app.inject({ method: "POST", url: `${base}/${itemId}/${step}`, headers: teacherAuth });
    expect(res.statusCode, `step ${step}`).toBe(200);
  }
  if (opts.nodeId) {
    expect((await app.inject({ method: "POST", url: `${base}/${itemId}/map`, headers: teacherAuth, payload: { nodeIds: [opts.nodeId] } })).statusCode).toBe(201);
  }
  if (opts.share) {
    expect((await app.inject({ method: "POST", url: `${base}/${itemId}/share`, headers: teacherAuth, payload: opts.share })).statusCode).toBe(200);
  }
  return itemId;
}

describe("#18 — shared library over HTTP", () => {
  it("happy path: a department-shared item reaches department colleagues with honest attribution, and nobody else", async () => {
    const { ctx, app } = makeApp();
    const school = await startSchool(app);
    const owner = await addTeacher(app, school.schoolId, school.auth, { firstName: "Olive", lastName: "Owner" });
    const colleague = await addTeacher(app, school.schoolId, school.auth, { firstName: "Cole", lastName: "League" });
    const outsider = await addTeacher(app, school.schoolId, school.auth, { firstName: "Oscar", lastName: "Elsewhere" });
    await setDepartment(ctx, owner.userId, "Mathematics");
    await setDepartment(ctx, colleague.userId, "Mathematics");
    await setDepartment(ctx, outsider.userId, "Science");

    const itemId = await approveItem(app, school.schoolId, owner.auth, {
      title: "Dept fractions pack", share: { type: "department", department: "Mathematics" },
    });

    // The owner sees their own item as theirs — no attribution echo.
    const ownRows = (await app.inject({ method: "GET", url: `/api/v1/schools/${school.schoolId}/content`, headers: owner.auth })).json() as
      { id: string; mine: boolean; ownerLabel: string | null }[];
    expect(ownRows.find((r) => r.id === itemId)).toMatchObject({ mine: true, ownerLabel: null });

    // The department colleague sees it attributed, with its provenance.
    const rows = (await app.inject({ method: "GET", url: `/api/v1/schools/${school.schoolId}/content`, headers: colleague.auth })).json() as
      { id: string; mine: boolean; ownerLabel: string | null; share: { type: string; label: string | null } }[];
    expect(rows.find((r) => r.id === itemId)).toMatchObject({
      mine: false, ownerLabel: "Olive Owner", share: { type: "department", label: "Mathematics" },
    });
    // And can read the text — that is what sharing is for.
    expect((await app.inject({ method: "GET", url: `/api/v1/schools/${school.schoolId}/content/${itemId}/sections`, headers: colleague.auth })).statusCode).toBe(200);

    // A teacher outside the department sees nothing of it, list or detail.
    const outsiderRows = (await app.inject({ method: "GET", url: `/api/v1/schools/${school.schoolId}/content`, headers: outsider.auth })).json() as { id: string }[];
    expect(outsiderRows.map((r) => r.id)).not.toContain(itemId);
    expect((await app.inject({ method: "GET", url: `/api/v1/schools/${school.schoolId}/content/${itemId}/sections`, headers: outsider.auth })).statusCode).toBe(404);
  });

  it("reuse: a colleague generates an assessment grounded in the shared item — and cannot manage the item itself", async () => {
    const { ctx, app } = makeApp();
    const school = await startSchool(app);
    await signOffGraph(app, school.schoolId, school.auth);
    const owner = await addTeacher(app, school.schoolId, school.auth, { firstName: "Olive", lastName: "Owner" });
    const colleague = await addTeacher(app, school.schoolId, school.auth, { firstName: "Cole", lastName: "League" });
    await setDepartment(ctx, owner.userId, "Mathematics");
    await setDepartment(ctx, colleague.userId, "Mathematics");

    const itemId = await approveItem(app, school.schoolId, owner.auth, {
      title: "Shared fractions material", nodeId: "skill-add-fractions",
      share: { type: "department", department: "Mathematics" },
    });

    // Reuse: the colleague's own draft, grounded in the owner's shared material.
    const generated = await app.inject({
      method: "POST", url: `/api/v1/schools/${school.schoolId}/assessments/generate`, headers: colleague.auth,
      payload: { title: "Cole's quiz", nodeIds: ["skill-add-fractions"], count: 2, difficulty: "mixed" },
    });
    expect(generated.json()).toMatchObject({ status: "generated", questionCount: 2 });

    // The boundary: read and reuse, never manage. Every management surface of a
    // colleague's item answers NOT_OWNER — approving, attesting, archiving,
    // re-sharing and re-tagging are all the owner's alone.
    const base = `/api/v1/schools/${school.schoolId}/content/${itemId}`;
    const attempts: [string, Record<string, unknown> | undefined][] = [
      [`${base}/approve`, undefined],
      [`${base}/attest`, undefined],
      [`${base}/archive`, undefined],
      [`${base}/share`, { type: "private" }],
      [`${base}/mark-official-syllabus`, { subject: "Mathematics", yearLevel: 8, sourceUrl: "https://example.edu/x" }],
    ];
    for (const [url, payload] of attempts) {
      const res = await app.inject({ method: "POST", url, headers: colleague.auth, payload });
      expect(res.statusCode, url).toBe(409);
      expect(res.json().code, url).toBe("NOT_OWNER");
    }
    // Nothing changed hands: the item is still shared and still the owner's.
    const rows = (await app.inject({ method: "GET", url: `/api/v1/schools/${school.schoolId}/content`, headers: colleague.auth })).json() as
      { id: string; mine: boolean }[];
    expect(rows.find((r) => r.id === itemId)).toMatchObject({ mine: false });
  });

  it("edge — a PRIVATE item's text is the owner's: colleagues get 404 on every read surface, not a listing gap with readable detail", async () => {
    const { app } = makeApp();
    const school = await startSchool(app);
    const owner = await addTeacher(app, school.schoolId, school.auth, { firstName: "Olive", lastName: "Owner" });
    const colleague = await addTeacher(app, school.schoolId, school.auth, { firstName: "Cole", lastName: "League" });

    const itemId = await approveItem(app, school.schoolId, owner.auth, { title: "Private notes" }); // default share: private

    const base = `/api/v1/schools/${school.schoolId}/content/${itemId}`;
    for (const url of [base, `${base}/sections`, `${base}/versions`, `${base}/mappings`]) {
      expect((await app.inject({ method: "GET", url, headers: colleague.auth })).statusCode, url).toBe(404);
      expect((await app.inject({ method: "GET", url, headers: owner.auth })).statusCode, url).toBe(200);
    }
  });

  it("edge — marking an item the official syllabus IS a school-wide share: it overrides a private scope", async () => {
    const { app } = makeApp();
    const school = await startSchool(app);
    const owner = await addTeacher(app, school.schoolId, school.auth, { firstName: "Olive", lastName: "Owner" });
    const colleague = await addTeacher(app, school.schoolId, school.auth, { firstName: "Cole", lastName: "League" });

    const itemId = await approveItem(app, school.schoolId, owner.auth, { title: "NESA Technology 7-8" });
    expect((await app.inject({
      method: "POST", url: `/api/v1/schools/${school.schoolId}/content/${itemId}/mark-official-syllabus`, headers: owner.auth,
      payload: { subject: "Technology", yearLevel: 8, sourceUrl: "https://curriculum.nsw.edu.au/tech" },
    })).statusCode).toBe(200);

    // Still share-scoped "private", but ADR-0035 promised every teacher of the
    // subject/year would see it — official status is the wider share.
    const rows = (await app.inject({ method: "GET", url: `/api/v1/schools/${school.schoolId}/content`, headers: colleague.auth })).json() as
      { id: string }[];
    expect(rows.map((r) => r.id)).toContain(itemId);
    expect((await app.inject({ method: "GET", url: `/api/v1/schools/${school.schoolId}/content/${itemId}/sections`, headers: colleague.auth })).statusCode).toBe(200);
  });

  it("edge — sharing never crosses schools, even into a department with the same name", async () => {
    const { ctx, app } = makeApp();
    const schoolA = await startSchool(app);
    const schoolB = await startSchool(app);
    const owner = await addTeacher(app, schoolA.schoolId, schoolA.auth, { firstName: "Olive", lastName: "Owner" });
    const rival = await addTeacher(app, schoolB.schoolId, schoolB.auth, { firstName: "Rita", lastName: "Rival" });
    await setDepartment(ctx, owner.userId, "Mathematics");
    await setDepartment(ctx, rival.userId, "Mathematics"); // same name, different school

    const itemId = await approveItem(app, schoolA.schoolId, owner.auth, {
      title: "School A only", share: { type: "department", department: "Mathematics" },
    });

    // School B's teacher sees nothing of it in their own school...
    const rows = (await app.inject({ method: "GET", url: `/api/v1/schools/${schoolB.schoolId}/content`, headers: rival.auth })).json() as { id: string }[];
    expect(rows.map((r) => r.id)).not.toContain(itemId);
    // ...and cannot reach School A's surfaces at all.
    expect((await app.inject({ method: "GET", url: `/api/v1/schools/${schoolA.schoolId}/content`, headers: rival.auth })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: `/api/v1/schools/${schoolA.schoolId}/content/${itemId}/sections`, headers: rival.auth })).statusCode).toBe(401);
  });
});
