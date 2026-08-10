import { ConflictError, NotFoundError } from "../domain/errors";
import type { MasteryLevel, MasteryRecord, MisconceptionSignal } from "../domain/mastery";
import { SYNTHETIC_THRESHOLDS } from "../domain/mastery";
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

    const studentIds: string[] = [];
    let masteryCount = 0;
    let misconceptionCount = 0;
    const rareSkill = skills[skills.length - 1]!; // covered by only a few students (small cohort)

    for (let i = 0; i < count; i++) {
      const student = await this.createSyntheticStudent(schoolId, classId);
      studentIds.push(student.id);

      // Every student has mastery on the common skills (varied levels).
      for (const nodeId of skills.slice(0, skills.length - 1)) {
        const score = round2(rand());
        // A few (student, skill) pairs are deliberately insufficient-data.
        const dataPoints = i >= 9 && i <= 12 && nodeId === skills[1] ? 1 : 3 + Math.floor(rand() * 8);
        const stale = i < 5; // the first five students are stale
        await this.putMastery({
          studentId: student.id, schoolId, nodeId, score, dataPoints,
          lastActivityAt: stale ? staleAt : recentAt,
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

      // Students 5–8 carry a persistent misconception (escalation signal).
      if (i >= 5 && i <= 8) {
        await this.activity.insertMisconception({
          id: newId(), studentId: student.id, schoolId, nodeId: skills[0]!,
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
    return { studentIds, masteryCount, misconceptionCount, skillCount: skills.length };
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
    studentId: string; schoolId: string; nodeId: string; score: number; dataPoints: number; lastActivityAt: string;
  }): Promise<void> {
    const record: MasteryRecord = {
      id: newId(), ...input, level: levelFor(input.score), synthetic: true,
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

function levelFor(score: number): MasteryLevel {
  if (score < 0.34) return "low";
  if (score < 0.67) return "developing";
  return "secure";
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
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
