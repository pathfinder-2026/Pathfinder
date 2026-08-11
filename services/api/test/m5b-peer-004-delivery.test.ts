import { describe, expect, it } from "vitest";
import { setupPeerClass } from "./helpers";

/**
 * Milestone 5b — FR-PEER-004: Peer Test Delivery (launch live or scheduled).
 * Cohort membership locks at launch; cancellation removes it cleanly.
 */
describe("M5b FR-PEER-004 — peer test delivery", () => {
  it("happy path — a launched test appears on each selected student's dashboard/calendar", async () => {
    const { ctx, schoolId, teacherId, nodeId, students } = await setupPeerClass({ students: 6 });
    const cohort = students.slice(0, 4);
    const test = await ctx.peerTests.buildPeerTest(teacherId, schoolId, { title: "Live test", nodeId, questionCount: 2, cohort, anonymity: "anonymous" });
    await ctx.peerTests.schedule(teacherId, test.id, ctx.clock.isoNow());
    await ctx.peerTests.launch(teacherId, test.id);

    for (const s of cohort) {
      const deliveries = await ctx.peerTests.deliveriesForStudent(s);
      expect(deliveries.some((d) => d.peerTestId === test.id)).toBe(true);
    }
    // A student NOT in the cohort has nothing placed.
    expect(await ctx.peerTests.deliveriesForStudent(students[5]!)).toHaveLength(0);
  });

  it("edge — cohort change after scheduling: included only if added before launch; locked once launched", async () => {
    const { ctx, schoolId, teacherId, nodeId, students } = await setupPeerClass({ students: 6 });
    const [a, b, addedBefore, addedAfter] = students;
    const test = await ctx.peerTests.buildPeerTest(teacherId, schoolId, { title: "Test", nodeId, questionCount: 2, cohort: [a!, b!], anonymity: "anonymous" });
    await ctx.peerTests.schedule(teacherId, test.id, ctx.clock.isoNow());

    // Added before launch → included.
    await ctx.peerTests.addToCohort(teacherId, test.id, addedBefore!);
    await ctx.peerTests.launch(teacherId, test.id);

    // Added after launch → blocked; cohort is locked.
    await expect(ctx.peerTests.addToCohort(teacherId, test.id, addedAfter!)).rejects.toMatchObject({ code: "COHORT_LOCKED" });

    expect(await ctx.peerTests.deliveriesForStudent(addedBefore!)).toHaveLength(1);
    expect(await ctx.peerTests.deliveriesForStudent(addedAfter!)).toHaveLength(0);
  });

  it("edge — cancelled before launch: removed cleanly with no partial artifacts", async () => {
    const { ctx, schoolId, teacherId, nodeId, students } = await setupPeerClass({ students: 6 });
    const cohort = students.slice(0, 4);
    const test = await ctx.peerTests.buildPeerTest(teacherId, schoolId, { title: "To cancel", nodeId, questionCount: 2, cohort, anonymity: "anonymous" });
    await ctx.peerTests.schedule(teacherId, test.id, ctx.clock.isoNow());

    const cancelled = await ctx.peerTests.cancel(teacherId, test.id);
    expect(cancelled.status).toBe("cancelled");
    expect(await ctx.peerStore.listPlacementsByTest(test.id)).toHaveLength(0);
    for (const s of cohort) expect(await ctx.peerTests.deliveriesForStudent(s)).toHaveLength(0);
  });
});
