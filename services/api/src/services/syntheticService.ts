import { ConflictError, NotFoundError } from "../domain/errors";
import type { MasteryRecord } from "../domain/mastery";
import { masteryLevel, SYNTHETIC_THRESHOLDS } from "../domain/mastery";
import type { Enrolment, Membership, User } from "../domain/types";
import type { AuditRecorder } from "../platform/audit/auditLog";
import type { Clock } from "../platform/clock";
import { newId } from "../platform/ids";
import type { ActivityStore } from "../ports/activityStore";
import type { DataStore } from "../ports/dataStore";
import type { SkillGraphStore } from "../ports/skillGraphStore";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface SeedSummary {
  studentIds: string[];
  masteryCount: number;
  misconceptionCount: number;
  skillCount: number;
  /**
   * Landmarks the Milestone 5a scenarios need to be deterministic. The seed
   * deliberately plants each M5a edge — a class focus area (with a sibling that
   * has no material → content gap), a fluctuating student (downward trend), a
   * conflicting-signals student, a 5-strong shared misconception, and a student
   * who fits two groups — the same way M4 plants the small-cohort/stale edges.
   */
  focusNodeId: string;
  contentGapNodeId: string;
  misconceptionNodeId: string;
  misconceptionStudentIds: string[];
  fluctuatingStudentId: string;
  conflictingStudentId: string;
  conflictingNodeId: string;
  multiGroupStudentId: string;
  staleStudentIds: string[];
}

/**
 * Milestone 4 — seed synthetic student activity, and enforce the quarantine
 * rules. Synthetic students carry `synthetic: true` (schema-level), hold no PII,
 * are excluded from every real/export surface, and are deletable before go-live.
 */
export class SyntheticService {
  constructor(
    private readonly store: DataStore,
    private readonly activity: ActivityStore,
    private readonly graph: SkillGraphStore,
    private readonly clock: Clock,
    private readonly audit: AuditRecorder,
  ) {}

  /** The tuning thresholds, RECORDED for re-validation against real data after M7. */
  thresholds() {
    return SYNTHETIC_THRESHOLDS;
  }

  /**
   * Seed ~`count` synthetic students in a class with varied mastery/misconception
   * patterns across the mapped skills — deliberately including the M5 edge cases:
   * small-cohort, stale-data, persistent-misconception and insufficient-data.
   */
  async seedClass(
    schoolId: string,
    classId: string,
    options: { count?: number; seed?: number } = {},
  ): Promise<SeedSummary> {
    const count = options.count ?? 25;
    const t = SYNTHETIC_THRESHOLDS;

    const skills = await this.mappedSkills(schoolId);
    if (skills.length < 2) {
      throw new ConflictError("NO_SKILLS", "A signed-off skill graph with skills is required before seeding.");
    }
    const klass = await this.store.getClass(classId);
    if (!klass) throw new NotFoundError("Class not found.");

    const rand = mulberry32(options.seed ?? 1337);
    const now = this.clock.now().getTime();
    const staleAt = new Date(now - (t.stalenessDays + 16) * DAY_MS).toISOString();
    const recentAt = new Date(now - 1 * DAY_MS).toISOString();

    const commonSkills = skills.slice(0, skills.length - 1);
    const rareSkill = skills[skills.length - 1]!; // covered by only a few students (small cohort)
    // Two skills the class is deliberately weak on: one gets material mapped in
    // tests (a real focus area), its sibling gets none (the content-gap edge).
    const misconceptionNodeId = commonSkills[0]!;
    const focusNodeId = commonSkills[1] ?? commonSkills[0]!;
    const contentGapNodeId = commonSkills[2] ?? focusNodeId;
    const weakOn = new Set([focusNodeId, contentGapNodeId]);
    const WEAK_BELOW = Math.ceil(count * 0.64); // ~64% below mastery → a focus area

    // Deliberately-planted individuals (indices chosen to avoid overlap).
    const MISCONCEPTION_RANGE = { from: 4, to: 8 }; // 5 students share a misconception
    const FLUCTUATING = 18; // downward trend on the focus skill
    const CONFLICTING = 19; // independent≫assisted on the misconception skill
    const MULTI_GROUP = 24; // secure overall AND on the focus skill → extension + peer-learning

    const studentIds: string[] = [];
    const misconceptionStudentIds: string[] = [];
    let masteryCount = 0;
    let misconceptionCount = 0;
    let fluctuatingStudentId = "";
    let conflictingStudentId = "";
    let multiGroupStudentId = "";

    for (let i = 0; i < count; i++) {
      const student = await this.createSyntheticStudent(schoolId, classId);
      studentIds.push(student.id);
      const stale = i < 5; // the first five students are stale
      if (i === FLUCTUATING) fluctuatingStudentId = student.id;
      if (i === CONFLICTING) conflictingStudentId = student.id;
      if (i === MULTI_GROUP) multiGroupStudentId = student.id;

      for (const nodeId of commonSkills) {
        // Score: weak skills push most of the class below mastery; the
        // multi-group student is secure everywhere so it qualifies for extension.
        let score: number;
        if (i === MULTI_GROUP) score = secureBand(rand);
        else if (weakOn.has(nodeId)) score = i < WEAK_BELOW ? belowBand(rand) : secureBand(rand);
        else score = round2(rand());
        let history: number[] | undefined;
        let assistedScore: number | null | undefined;

        // Fluctuating student: a clear downward trend on the focus skill, so the
        // dashboard must show the trend rather than only the latest point.
        if (i === FLUCTUATING && nodeId === focusNodeId) {
          history = [0.85, 0.6];
          score = 0.35;
        }
        // Conflicting-signals student: strong independently, weak when assisted.
        if (i === CONFLICTING && nodeId === misconceptionNodeId) {
          score = 0.85;
          assistedScore = 0.3;
        }

        // A few (student, skill) pairs are deliberately insufficient-data.
        const dataPoints = i >= 9 && i <= 12 && nodeId === focusNodeId ? 1 : 3 + Math.floor(rand() * 8);
        await this.putMastery({
          studentId: student.id, schoolId, nodeId, score, dataPoints,
          lastActivityAt: stale ? staleAt : recentAt, history, assistedScore,
        });
        masteryCount++;
      }

      // The rare skill is only touched by the first three students → small cohort.
      if (i < 3) {
        await this.putMastery({
          studentId: student.id, schoolId, nodeId: rareSkill, score: round2(rand()),
          dataPoints: 4, lastActivityAt: recentAt,
        });
        masteryCount++;
      }

      // Students 4–8 (five of them) share a persistent misconception → escalation.
      if (i >= MISCONCEPTION_RANGE.from && i <= MISCONCEPTION_RANGE.to) {
        misconceptionStudentIds.push(student.id);
        await this.activity.insertMisconception({
          id: newId(), studentId: student.id, schoolId, nodeId: misconceptionNodeId,
          misconception: "adds numerators and denominators separately",
          occurrences: t.misconceptionEscalationMin + 1,
          lastSeenAt: recentAt, synthetic: true,
        });
        misconceptionCount++;
      }
    }

    this.audit.append({
      action: "synthetic.class.seeded",
      actorId: null,
      subjectType: "class",
      subjectId: classId,
      metadata: { students: count, masteryCount, misconceptionCount, thresholds: t },
    });
    return {
      studentIds, masteryCount, misconceptionCount, skillCount: skills.length,
      focusNodeId, contentGapNodeId, misconceptionNodeId, misconceptionStudentIds,
      fluctuatingStudentId, conflictingStudentId, conflictingNodeId: misconceptionNodeId,
      multiGroupStudentId, staleStudentIds: studentIds.slice(0, 5),
    };
  }

  // ---- quarantine queries ----

  /** Synthetic students in a school. */
  async listSyntheticStudents(schoolId: string): Promise<User[]> {
    return (await this.studentsInSchool(schoolId)).filter((u) => u.synthetic);
  }

  /** Real (non-synthetic) students — the ONLY students any export/report/parent
   * surface may read. */
  async exportRealStudents(schoolId: string): Promise<User[]> {
    return (await this.studentsInSchool(schoolId)).filter((u) => !u.synthetic);
  }

  /** Whether a mastery snapshot is safe to surface (synthetic never is). */
  realMastery(records: MasteryRecord[]): MasteryRecord[] {
    return records.filter((r) => !r.synthetic);
  }

  /**
   * Delete all synthetic students and their data (before pilot go-live). Real
   * accounts are untouched. Audited.
   */
  async deleteSyntheticStudents(schoolId: string): Promise<number> {
    const synthetic = await this.listSyntheticStudents(schoolId);
    for (const s of synthetic) {
      await this.activity.deleteByStudent(s.id);
      await this.store.deleteEnrolmentsByStudent(s.id);
      for (const m of await this.store.listMembershipsByUser(s.id)) await this.store.deleteMembership(m.id);
      await this.store.deletePersonalData(s.id);
      await this.store.deleteUser(s.id);
    }
    this.audit.append({
      action: "synthetic.deleted",
      actorId: null,
      subjectType: "school",
      subjectId: schoolId,
      metadata: { deleted: synthetic.length },
    });
    return synthetic.length;
  }

  // ---- helpers ----

  private async createSyntheticStudent(schoolId: string, classId: string): Promise<User> {
    const now = this.clock.isoNow();
    // Synthetic students hold NO PII (minimisation + quarantine).
    const user: User = { id: newId(), schoolId, status: "active", synthetic: true, createdAt: now };
    await this.store.insertUser(user);
    const membership: Membership = {
      id: newId(), userId: user.id, schoolId, role: "student", campusId: null, classId, department: null,
    };
    await this.store.insertMembership(membership);
    const enrolment: Enrolment = { id: newId(), studentId: user.id, classId, schoolId, active: true };
    await this.store.insertEnrolment(enrolment);
    return user;
  }

  private async putMastery(input: {
    studentId: string; schoolId: string; nodeId: string; score: number; dataPoints: number;
    lastActivityAt: string; history?: number[]; assistedScore?: number | null;
  }): Promise<void> {
    const record: MasteryRecord = {
      id: newId(), ...input, level: masteryLevel(input.score), synthetic: true,
    };
    await this.activity.insertMastery(record);
  }

  /** Skill nodes the school's signed-off graph exposes (the "mapped skills"). */
  private async mappedSkills(schoolId: string): Promise<string[]> {
    const config = await this.graph.getSchoolCurriculum(schoolId);
    const version = await this.graph.latestSignedOffVersion(config?.curriculum ?? "NSW");
    if (!version) return [];
    return (await this.graph.listNodes(version.id)).filter((n) => n.type === "skill").map((n) => n.id);
  }

  private async studentsInSchool(schoolId: string): Promise<User[]> {
    const studentIds = new Set(
      (await this.store.listMembershipsBySchool(schoolId)).filter((m) => m.role === "student").map((m) => m.userId),
    );
    const users: User[] = [];
    for (const id of studentIds) {
      const u = await this.store.getUser(id);
      if (u) users.push(u);
    }
    return users;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
/** Below the mastery threshold: [0.15, 0.50). */
function belowBand(rand: () => number): number {
  return round2(0.15 + rand() * 0.35);
}
/** Securely above the mastery threshold: [0.70, 0.95). */
function secureBand(rand: () => number): number {
  return round2(0.7 + rand() * 0.25);
}

/** Deterministic PRNG so seeding is reproducible in tests. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
