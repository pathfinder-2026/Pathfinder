import { describe, expect, it } from "vitest";
import { buildApp } from "../src/http/app";
import { buildContext } from "../src/context";
import { FixedClock } from "../src/platform/clock";
import { makeApprovedContent, makeHarness, makeTeacher, seedSchoolWithAdmin, setupSignedGraph } from "./helpers";

const SYLLABUS = [
  "# Design and Production Skills",
  "Students identify needs and opportunities for design. Students generate and communicate design ideas.",
  "# Material Technologies",
  "Students select materials for a given purpose. Students apply safe workshop practices.",
].join("\n");

/**
 * Task #15 — approving a syllabus DOCUMENT is not the same as having a
 * CURRICULUM. A school approved a NESA Technology syllabus and it still had
 * nowhere to map, so it was filed under "Simplify fractions" — putting
 * Technology prose in the maths grounding pool.
 */
describe("Drafting a curriculum from an approved syllabus", () => {
  async function setup() {
    const { ctx } = makeHarness();
    const { school } = await seedSchoolWithAdmin(ctx);
    const teacher = await makeTeacher(ctx, school.id, "teacher@springfield.edu");
    await setupSignedGraph(ctx, school.id); // the school's existing Maths Y8 graph
    return { ctx, schoolId: school.id, teacherId: teacher.user.id };
  }

  async function approvedSyllabus(ctx: Awaited<ReturnType<typeof setup>>["ctx"], schoolId: string, teacherId: string) {
    const itemId = await makeApprovedContent(ctx, schoolId, teacherId, { title: "NESA Technology 7-8", text: SYLLABUS });
    await ctx.content.markOfficialSyllabus(itemId, teacherId, {
      subject: "Technology", yearLevel: 8, sourceUrl: "https://curriculum.nsw.edu.au/technology",
    });
    return itemId;
  }

  it("drafts a Technology curriculum from the document's own text, as a DRAFT", async () => {
    const { ctx, schoolId, teacherId } = await setup();
    const itemId = await approvedSyllabus(ctx, schoolId, teacherId);
    const chunks = await ctx.contentStore.listChunksByVersion(
      (await ctx.contentStore.getContentItem(itemId))!.currentVersionId,
    );

    const version = await ctx.skillGraph.draftFromSyllabus(schoolId, {
      contentItemId: itemId, subject: "Technology", yearLevel: 8,
      sections: chunks.map((c) => ({ heading: c.heading, text: c.text })),
    }, teacherId);

    expect(version.subject).toBe("Technology");
    expect(version.yearLevel).toBe(8);
    // NEVER auto-signed: a human reviews it against the source syllabus first.
    expect(version.status).toBe("draft");

    const nodes = await ctx.skillGraphStore.listNodes(version.id);
    // Structure came from the document's own headings, not from model knowledge.
    expect(nodes.filter((n) => n.type === "strand").map((n) => n.label))
      .toEqual(expect.arrayContaining(["Design and Production Skills", "Material Technologies"]));
    expect(nodes.filter((n) => n.type === "skill").length).toBeGreaterThan(0);
    // Ids are namespaced, so they can never collide with the maths graph's.
    expect(nodes.every((n) => n.id.startsWith("technology-y8-"))).toBe(true);
  });

  it("stays invisible to teachers until signed off, then appears as its own subject", async () => {
    const { ctx, schoolId, teacherId } = await setup();
    const itemId = await approvedSyllabus(ctx, schoolId, teacherId);
    const chunks = await ctx.contentStore.listChunksByVersion(
      (await ctx.contentStore.getContentItem(itemId))!.currentVersionId,
    );
    const version = await ctx.skillGraph.draftFromSyllabus(schoolId, {
      contentItemId: itemId, subject: "Technology", yearLevel: 8,
      sections: chunks.map((c) => ({ heading: c.heading, text: c.text })),
    }, teacherId);

    const signedBefore = await ctx.skillGraphStore.listSignedOffVersions("NSW");
    expect(signedBefore.map((v) => v.subject)).toEqual(["Mathematics"]);

    await ctx.skillGraph.signOff(version.id, teacherId); // teachers may sign off
    const signedAfter = await ctx.skillGraphStore.listSignedOffVersions("NSW");
    expect(signedAfter.map((v) => v.subject).sort()).toEqual(["Mathematics", "Technology"]);
    // The sign-off is attributed, so widening who may certify keeps the trail.
    expect(ctx.audit.find((e) => e.action === "skillgraph.signed_off").at(-1)?.actorId).toBe(teacherId);
  });

  it("refuses to file a subject's syllabus under a DIFFERENT subject's curriculum", async () => {
    const { ctx, schoolId, teacherId } = await setup();
    const itemId = await approvedSyllabus(ctx, schoolId, teacherId);

    // The exact production incident: Technology syllabus → a maths skill.
    await expect(ctx.mapping.mapContent(itemId, ["skill-add-fractions"], { source: "teacher" }))
      .rejects.toThrow(/tagged as the Technology syllabus/i);
  });

  it("a wrong mapping can be removed, and the removal is audited", async () => {
    const { ctx, schoolId, teacherId } = await setup();
    // An untagged item can still be mapped anywhere — that is how the bad
    // production mapping was created before the guard existed.
    const itemId = await makeApprovedContent(ctx, schoolId, teacherId, { title: "Mistagged", text: "# T\nProse here." });
    const [mapping] = await ctx.mapping.mapContent(itemId, ["skill-add-fractions"], { source: "teacher" });

    await ctx.mapping.unmap(mapping!.id, teacherId);
    expect(await ctx.skillGraphStore.listMappingsByContent(itemId)).toHaveLength(0);
    expect(ctx.audit.find((e) => e.action === "skillgraph.mapping.removed")).toHaveLength(1);
  });

  it("over HTTP: an unapproved document cannot become a curriculum", async () => {
    const ctx = buildContext({ clock: new FixedClock() });
    const app = buildApp({}, ctx);
    const { school } = await seedSchoolWithAdmin(ctx);
    const teacher = await makeTeacher(ctx, school.id, "t@springfield.edu");
    await setupSignedGraph(ctx, school.id);
    // A real session, so the route's own auth guard is exercised too.
    await ctx.auth.setInitialPassword(teacher.user.id, "password123");
    const session = await ctx.auth.login("t@springfield.edu", "password123");

    // Uploaded but never approved.
    const up = await ctx.content.uploadOne(school.id, teacher.user.id, {
      title: "Draft syllabus", fileType: "pdf", sizeBytes: 900,
      contentHash: "hash-unapproved", source: { text: SYLLABUS },
    });
    if (up.status !== "accepted") throw new Error("upload not accepted");
    await ctx.ingestion.ingest((await ctx.contentStore.getContentItem(up.contentItemId))!.currentVersionId, teacher.user.id);

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/schools/${school.id}/content/${up.contentItemId}/draft-curriculum`,
      headers: { authorization: `Bearer ${session.token}` },
      payload: { subject: "Technology", yearLevel: 8 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("CONTENT_NOT_APPROVED");
    await app.close();
  });
});
