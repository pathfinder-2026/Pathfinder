import { ConflictError } from "../domain/errors";
import { type CoCurricularDomain, type CoCurricularRecord } from "../domain/reporting";
import type { AuditRecorder } from "../platform/audit/auditLog";
import type { Clock } from "../platform/clock";
import { newId } from "../platform/ids";
import type { DataStore } from "../ports/dataStore";
import type { ReportingStore } from "../ports/reportingStore";

const DOMAINS: CoCurricularDomain[] = ["sport", "arts", "music"];

/**
 * Milestone 10 — FR-CAP-002. Co-curricular capability (sport/arts/music) in its own
 * SIMPLER structure — a free-text skill + level, NOT the academic skill graph — and
 * kept clearly separate from academic mastery wherever it is shown.
 */
export class CoCurricularService {
  constructor(
    private readonly reporting: ReportingStore,
    private readonly store: DataStore,
    private readonly clock: Clock,
    private readonly audit: AuditRecorder,
  ) {}

  async recordCapability(teacherId: string, schoolId: string, input: { studentId: string; domain: CoCurricularDomain; skill: string; level: string }): Promise<CoCurricularRecord> {
    await this.requireTeacher(teacherId, schoolId);
    if (!DOMAINS.includes(input.domain)) throw new ConflictError("INVALID_DOMAIN", `Domain must be one of: ${DOMAINS.join(", ")}.`);
    const record: CoCurricularRecord = {
      id: newId(), schoolId, studentId: input.studentId, domain: input.domain, skill: input.skill, level: input.level,
      teacherId, createdAt: this.clock.isoNow(),
    };
    await this.reporting.insertCoCurricular(record);
    this.audit.append({ action: "cocurricular.recorded", actorId: teacherId, subjectType: "student", subjectId: input.studentId, metadata: { domain: input.domain } });
    return record;
  }

  /** A student's co-curricular capability — separate from academic mastery. */
  capabilityFor(studentId: string): Promise<CoCurricularRecord[]> {
    return this.reporting.listCoCurricularByStudent(studentId);
  }

  private async requireTeacher(actorId: string, schoolId: string): Promise<void> {
    const memberships = await this.store.listMembershipsByUser(actorId);
    if (!memberships.some((m) => m.schoolId === schoolId && m.role === "teacher")) {
      throw new ConflictError("NOT_A_TEACHER", "Only a Teacher may record co-curricular capability.");
    }
  }
}
