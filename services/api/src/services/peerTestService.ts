import { ConflictError, NotFoundError } from "../domain/errors";
import {
  anonymityRisk,
  computeBenchmark,
  softenedSignalFor,
  PEER_THRESHOLDS,
  type Accommodation,
  type AnonymityLevel,
  type CohortBenchmark,
  type PeerTest,
  type SoftenedSignal,
} from "../domain/peer";
import type { AuditRecorder } from "../platform/audit/auditLog";
import type { Clock } from "../platform/clock";
import { newId } from "../platform/ids";
import type { ContentStore } from "../ports/contentStore";
import type { DataStore } from "../ports/dataStore";
import type { PeerStore } from "../ports/peerStore";
import type { SkillGraphStore } from "../ports/skillGraphStore";
import type { ContentService } from "./contentService";

export interface BuildPeerTestConfig {
  title: string;
  nodeId: string;
  questionCount: number;
  rubric?: string | null;
  cohort: string[];
  anonymity: AnonymityLevel;
  accommodations?: Accommodation[];
}

export interface PeerTestResults {
  completion: { completed: number; total: number; rate: number };
  benchmark: CohortBenchmark;
  publishState: PeerTest["benchmarkPublish"];
  /** True until the Teacher makes an explicit publish/withhold decision. */
  requiresPublishDecision: boolean;
}

/**
 * Milestone 5b — Peer Test lifecycle + cohort benchmarking (FR-PEER-001/003/004/005).
 *
 * Computed results are IMMUTABLE by construction: there is deliberately no method
 * to edit a figure. The Teacher may only publish or withhold, and a genuine
 * correction goes through `recordCorrection` — a separate, audited path that never
 * overwrites the original submission. Nothing is ever auto-released to students.
 */
export class PeerTestService {
  private readonly t = PEER_THRESHOLDS;

  constructor(
    private readonly peers: PeerStore,
    private readonly content: ContentService,
    private readonly contentStore: ContentStore,
    private readonly graph: SkillGraphStore,
    private readonly store: DataStore,
    private readonly clock: Clock,
    private readonly audit: AuditRecorder,
  ) {}

  thresholds() { return PEER_THRESHOLDS; }

  /** FR-PEER-003 — build a draft peer test; surface tensions/shortfalls, never silent. */
  async buildPeerTest(teacherId: string, schoolId: string, config: BuildPeerTestConfig): Promise<PeerTest> {
    await this.requireTeacher(teacherId, schoolId);
    const accommodations = config.accommodations ?? [];
    const warnings: string[] = [];

    // Edge — insufficient content for the requested scope: tell the Teacher what's
    // missing rather than silently generating a thin/unreliable test.
    const capacity = await this.groundingCapacity(schoolId, config.nodeId);
    let questionCount = config.questionCount;
    if (capacity < config.questionCount) {
      warnings.push(`insufficient_content: requested ${config.questionCount} question(s) but only ${capacity} grounded item(s) of approved content exist for this skill.`);
      questionCount = capacity;
    }

    // Edge — accommodation vs anonymity tension: an accommodation could reveal a
    // student within a small anonymous cohort. Warn; never silently apply both.
    if (config.anonymity === "anonymous" && accommodations.length > 0 && anonymityRisk(config.cohort.length, this.t)) {
      warnings.push(`accommodation_anonymity_tension: an accommodation may reveal a student's identity within an anonymous cohort of ${config.cohort.length}.`);
    }

    const test: PeerTest = {
      id: newId(), schoolId, teacherId, title: config.title, nodeId: config.nodeId,
      questionCount, rubric: config.rubric ?? null, cohort: [...config.cohort],
      anonymity: config.anonymity, accommodations, status: "draft", benchmarkPublish: "withheld",
      scheduledStart: null, launchedAt: null, closedAt: null, cancelledAt: null,
      warnings, createdAt: this.clock.isoNow(),
    };
    await this.peers.insertPeerTest(test);
    this.audit.append({ action: "peer.test.built", actorId: teacherId, subjectType: "peer_test", subjectId: test.id, metadata: { warnings } });
    return test;
  }

  /** FR-PEER-004 — schedule a peer test for a future launch. */
  async schedule(teacherId: string, peerTestId: string, scheduledStart: string): Promise<PeerTest> {
    const test = await this.owned(teacherId, peerTestId);
    if (test.status === "launched" || test.status === "cancelled") {
      throw new ConflictError("BAD_STATE", "Only a draft/scheduled peer test can be scheduled.");
    }
    test.status = "scheduled";
    test.scheduledStart = scheduledStart;
    await this.peers.updatePeerTest(test);
    return test;
  }

  /** FR-PEER-004 — add a student to the cohort. Allowed ONLY before launch. */
  async addToCohort(teacherId: string, peerTestId: string, studentId: string): Promise<PeerTest> {
    const test = await this.owned(teacherId, peerTestId);
    if (test.status === "launched" || test.status === "closed") {
      throw new ConflictError("COHORT_LOCKED", "Cohort membership is locked once the peer test has launched.");
    }
    if (!test.cohort.includes(studentId)) test.cohort.push(studentId);
    await this.peers.updatePeerTest(test);
    return test;
  }

  /** FR-PEER-004 — launch: LOCK the cohort and place the test on each student's dashboard/calendar. */
  async launch(teacherId: string, peerTestId: string): Promise<PeerTest> {
    const test = await this.owned(teacherId, peerTestId);
    if (test.status === "launched") return test;
    if (test.status === "cancelled") throw new ConflictError("BAD_STATE", "A cancelled peer test cannot be launched.");
    const now = this.clock.isoNow();
    test.status = "launched";
    test.launchedAt = now;
    await this.peers.updatePeerTest(test);
    // Placement == the dashboard/calendar entry (the full calendar arrives in M7).
    for (const studentId of test.cohort) {
      await this.peers.insertPlacement({ id: newId(), peerTestId: test.id, studentId, placedAt: now });
    }
    this.audit.append({ action: "peer.test.launched", actorId: teacherId, subjectType: "peer_test", subjectId: test.id, metadata: { cohortSize: test.cohort.length } });
    return test;
  }

  /** FR-PEER-004 — cancel before launch: remove all placements cleanly, no partial artifacts. */
  async cancel(teacherId: string, peerTestId: string): Promise<PeerTest> {
    const test = await this.owned(teacherId, peerTestId);
    if (test.status === "launched" || test.status === "closed") {
      throw new ConflictError("ALREADY_LAUNCHED", "A launched peer test cannot be cancelled.");
    }
    await this.peers.deletePlacementsByTest(test.id);
    test.status = "cancelled";
    test.cancelledAt = this.clock.isoNow();
    await this.peers.updatePeerTest(test);
    this.audit.append({ action: "peer.test.cancelled", actorId: teacherId, subjectType: "peer_test", subjectId: test.id, metadata: {} });
    return test;
  }

  /** FR-PEER-004 — the peer tests currently on a student's dashboard/calendar. */
  async deliveriesForStudent(studentId: string): Promise<{ peerTestId: string; title: string; placedAt: string }[]> {
    const placements = await this.peers.listPlacementsByStudent(studentId);
    const out: { peerTestId: string; title: string; placedAt: string }[] = [];
    for (const p of placements) {
      const test = await this.peers.getPeerTest(p.peerTestId);
      if (test && test.status === "launched") out.push({ peerTestId: test.id, title: test.title, placedAt: p.placedAt });
    }
    return out;
  }

  /** A student completes the peer test (records their graded result). */
  async recordSubmission(peerTestId: string, studentId: string, score: number): Promise<void> {
    const test = await this.peers.getPeerTest(peerTestId);
    if (!test) throw new NotFoundError("Peer test not found.");
    if (test.status !== "launched") throw new ConflictError("NOT_LIVE", "The peer test is not live.");
    await this.peers.insertSubmission({ id: newId(), peerTestId, studentId, score, submittedAt: this.clock.isoNow() });
  }

  async close(teacherId: string, peerTestId: string): Promise<PeerTest> {
    const test = await this.owned(teacherId, peerTestId);
    test.status = "closed";
    test.closedAt = this.clock.isoNow();
    await this.peers.updatePeerTest(test);
    return test;
  }

  /** FR-PEER-001 / FR-PEER-005 — the teacher-facing cohort benchmark (full figures). */
  async benchmark(teacherId: string, peerTestId: string): Promise<CohortBenchmark> {
    const test = await this.owned(teacherId, peerTestId);
    const scores = await this.effectiveScores(test.id);
    return computeBenchmark(test.id, scores, test.cohort.length, test.benchmarkPublish, this.t);
  }

  /** FR-PEER-005 — completion status + benchmark, with an explicit decision required. */
  async results(teacherId: string, peerTestId: string): Promise<PeerTestResults> {
    const test = await this.owned(teacherId, peerTestId);
    const benchmark = await this.benchmark(teacherId, peerTestId);
    const completed = (await this.peers.listSubmissions(test.id)).length;
    const total = test.cohort.length;
    return {
      completion: { completed, total, rate: total ? completed / total : 0 },
      benchmark,
      publishState: test.benchmarkPublish,
      requiresPublishDecision: test.benchmarkPublish === "withheld",
    };
  }

  /** FR-PEER-001/005 — publish the computed benchmark to students (explicit decision). */
  async publish(teacherId: string, peerTestId: string): Promise<PeerTest> {
    const test = await this.owned(teacherId, peerTestId);
    test.benchmarkPublish = "published";
    await this.peers.updatePeerTest(test);
    this.audit.append({ action: "peer.benchmark.published", actorId: teacherId, subjectType: "peer_test", subjectId: test.id, metadata: {} });
    return test;
  }

  /** FR-PEER-001/005 — withhold (the default). */
  async withhold(teacherId: string, peerTestId: string): Promise<PeerTest> {
    const test = await this.owned(teacherId, peerTestId);
    test.benchmarkPublish = "withheld";
    await this.peers.updatePeerTest(test);
    this.audit.append({ action: "peer.benchmark.withheld", actorId: teacherId, subjectType: "peer_test", subjectId: test.id, metadata: {} });
    return test;
  }

  /**
   * FR-PEER-001 — the softened, non-ranked signal a student may see. Returns a
   * withheld result unless the Teacher has explicitly published; there is no timer
   * anywhere that would auto-release it.
   */
  async studentSignal(peerTestId: string, studentId: string): Promise<SoftenedSignal> {
    const test = await this.peers.getPeerTest(peerTestId);
    if (!test) throw new NotFoundError("Peer test not found.");
    const scores = await this.effectiveScores(test.id);
    const benchmark = computeBenchmark(test.id, scores, test.cohort.length, test.benchmarkPublish, this.t);
    return softenedSignalFor(benchmark, studentId);
  }

  /**
   * FR-PEER-005 — the ONLY way to change a result: a separate, logged correction
   * (e.g. a grading error). It never overwrites the original submission — the
   * computed figures stay auditable. There is deliberately no "edit score" method.
   */
  async recordCorrection(teacherId: string, peerTestId: string, studentId: string, correctedScore: number, reason: string): Promise<void> {
    const test = await this.owned(teacherId, peerTestId);
    if (!reason.trim()) throw new ConflictError("REASON_REQUIRED", "A correction must record a reason.");
    const scores = await this.effectiveScores(test.id);
    const current = scores.find((s) => s.studentId === studentId);
    if (!current) throw new NotFoundError("No submission to correct for that student.");
    await this.peers.insertCorrection({
      id: newId(), peerTestId: test.id, studentId, previousScore: current.score,
      correctedScore, reason, correctedBy: teacherId, at: this.clock.isoNow(),
    });
    this.audit.append({
      action: "peer.result.corrected", actorId: teacherId, subjectType: "peer_test", subjectId: test.id,
      metadata: { studentId, previousScore: current.score, correctedScore, reason },
    });
  }

  // ---- helpers ----

  /** Effective scores = submission score, unless overridden by the latest logged correction. */
  private async effectiveScores(peerTestId: string): Promise<{ studentId: string; score: number }[]> {
    const submissions = await this.peers.listSubmissions(peerTestId);
    const corrections = (await this.peers.listCorrections(peerTestId))
      .sort((a, b) => a.at.localeCompare(b.at));
    const latest = new Map<string, number>();
    for (const c of corrections) latest.set(c.studentId, c.correctedScore);
    return submissions.map((s) => ({ studentId: s.studentId, score: latest.get(s.studentId) ?? s.score }));
  }

  private async groundingCapacity(schoolId: string, nodeId: string): Promise<number> {
    const pool = await this.content.approvedPool(schoolId);
    let chunks = 0;
    for (const item of pool) {
      const mapped = (await this.graph.listMappingsByContent(item.id)).some((m) => m.nodeId === nodeId);
      if (!mapped) continue;
      chunks += (await this.contentStore.listChunksByVersion(item.currentVersionId)).length;
    }
    return chunks;
  }

  private async owned(teacherId: string, peerTestId: string): Promise<PeerTest> {
    const test = await this.peers.getPeerTest(peerTestId);
    if (!test) throw new NotFoundError("Peer test not found.");
    await this.requireTeacher(teacherId, test.schoolId);
    return test;
  }

  private async requireTeacher(actorId: string, schoolId: string): Promise<void> {
    const memberships = await this.store.listMembershipsByUser(actorId);
    if (!memberships.some((m) => m.schoolId === schoolId && m.role === "teacher")) {
      throw new ConflictError("NOT_A_TEACHER", "Only a Teacher may manage peer tests.");
    }
  }
}
