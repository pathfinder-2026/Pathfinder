import {
  DASHBOARD_THRESHOLDS,
  belowMastery,
  isStale,
  latestPerPair,
  type NextAction,
  type RevisionReminder,
} from "../domain/insights";
import { SYNTHETIC_THRESHOLDS, type MasteryRecord, type MisconceptionSignal } from "../domain/mastery";
import type { AuditRecorder } from "../platform/audit/auditLog";
import type { Clock } from "../platform/clock";
import type { NotificationService } from "../platform/notifications/notificationService";
import type { ActivityStore } from "../ports/activityStore";
import type { AssessmentStore } from "../ports/assessmentStore";
import type { DataStore } from "../ports/dataStore";

export interface Escalation {
  studentId: string;
  nodeId: string;
  misconception: string;
  occurrences: number;
}

/**
 * Milestone 5a — FR-ADP-001 / FR-ADP-002. Recommends the next best action for a
 * student's Teacher-assigned work (revision, progression, hints, remediation,
 * extension, reassessment) and schedules spaced revision. Two guarantees:
 *   • A persistent misconception is ESCALATED to the Teacher on the dashboard —
 *     the engine never loops the same remediation indefinitely.
 *   • Recommendations weigh the whole picture (independent vs assisted, trend),
 *     never only the most recent score.
 * Nothing here assigns to a student autonomously — it advises the Teacher.
 */
export class AdaptiveEngine {
  private readonly t = DASHBOARD_THRESHOLDS;

  constructor(
    private readonly activity: ActivityStore,
    private readonly assessments: AssessmentStore,
    private readonly store: DataStore,
    private readonly clock: Clock,
    private readonly audit: AuditRecorder,
    private readonly notifications: NotificationService,
  ) {}

  /** FR-ADP-001 — the recommended next action for one (student, skill). */
  async nextAction(schoolId: string, studentId: string, nodeId: string): Promise<NextAction> {
    // Edge — persistent misconception: escalate rather than auto-remediate again.
    const misc = (await this.activity.listMisconceptionsBySchool(schoolId)).find(
      (m) => m.studentId === studentId && m.nodeId === nodeId,
    );
    if (misc && misc.occurrences >= SYNTHETIC_THRESHOLDS.misconceptionEscalationMin) {
      await this.escalate(schoolId, { studentId, nodeId, misconception: misc.misconception, occurrences: misc.occurrences });
      return {
        studentId, nodeId, action: "escalate", escalated: true,
        reason: `Persistent misconception ("${misc.misconception}") across ${misc.occurrences} attempts — handed to the Teacher instead of repeating remediation.`,
      };
    }

    const record = latestPerPair(await this.activity.listMasteryByNode(schoolId, nodeId)).find(
      (r) => r.studentId === studentId,
    );
    if (!record) {
      return { studentId, nodeId, action: "revision", escalated: false, reason: "No mastery signal yet — start with revision." };
    }

    // Edge — conflicting signals: independent vs assisted performance diverge.
    // Account for BOTH rather than trusting the latest score alone.
    if (record.assistedScore !== null && record.assistedScore !== undefined) {
      const gap = record.score - record.assistedScore;
      if (Math.abs(gap) >= this.t.trendDelta) {
        if (record.score >= this.t.masteryScore && record.assistedScore < this.t.masteryScore) {
          // Strong solo but weak when scaffolded → likely fragile; consolidate, don't leap ahead.
          return {
            studentId, nodeId, action: "reassessment", escalated: false,
            reason: "Independent work is strong but assisted work is weak — reassess to confirm before progressing, rather than trusting the latest score.",
          };
        }
        // Weak solo but strong with help → not yet independent; scaffold with hints.
        return {
          studentId, nodeId, action: "hint", escalated: false,
          reason: "Assisted work is strong but independent work is weak — offer hints/scaffolding toward independence, weighing both signals.",
        };
      }
    }

    // Happy path — strong mastery → progression/extension, not repeating content.
    if (!belowMastery(record.score, this.t)) {
      return { studentId, nodeId, action: "extension", escalated: false, reason: "Strong mastery — recommend progression/extension over repeating mastered content." };
    }
    if (record.score < this.t.interventionScore) {
      return { studentId, nodeId, action: "remediation", escalated: false, reason: "Low mastery — recommend targeted remediation." };
    }
    return { studentId, nodeId, action: "revision", escalated: false, reason: "Developing mastery — recommend revision to consolidate." };
  }

  /**
   * FR-ADP (persistent misconception) — the escalations the dashboard shows the
   * Teacher. Detecting one also notifies the class Teacher via the single
   * notification service (its first Milestone 5 consumer).
   */
  async escalations(schoolId: string, classId: string): Promise<Escalation[]> {
    const studentIds = new Set(await this.classStudentIds(schoolId, classId));
    const persistent = (await this.activity.listMisconceptionsBySchool(schoolId)).filter(
      (m) => studentIds.has(m.studentId) && m.occurrences >= SYNTHETIC_THRESHOLDS.misconceptionEscalationMin,
    );
    return persistent.map((m) => ({
      studentId: m.studentId, nodeId: m.nodeId, misconception: m.misconception, occurrences: m.occurrences,
    }));
  }

  /**
   * FR-ADP-002 — spaced-revision reminders. A reminder that would normally fire
   * while the student has an assessment in progress is DEFERRED until after it,
   * never interrupting the assessment.
   */
  async dueRevisionReminders(schoolId: string, classId: string): Promise<RevisionReminder[]> {
    const studentIds = await this.classStudentIds(schoolId, classId);
    const inClass = new Set(studentIds);
    const records = latestPerPair(
      (await this.activity.listMasteryBySchool(schoolId)).filter((r) => inClass.has(r.studentId)),
    );
    const nowIso = this.clock.isoNow();
    const reminders: RevisionReminder[] = [];

    for (const r of records) {
      // Spaced revision is due when a practised skill hasn't been revisited recently.
      if (!isStale(r, nowIso, this.t)) continue;
      const midAssessment = await this.hasAttemptInProgress(r.studentId);
      reminders.push({
        studentId: r.studentId,
        nodeId: r.nodeId,
        deferred: midAssessment,
        reason: midAssessment ? "Assessment in progress — deferred until it finishes." : null,
      });
    }
    return reminders;
  }

  // ---- helpers ----

  private async hasAttemptInProgress(studentId: string): Promise<boolean> {
    return (await this.assessments.listAttemptsByStudent(studentId)).some((a) => a.status === "in_progress");
  }

  private async escalate(schoolId: string, e: Escalation): Promise<void> {
    this.audit.append({
      action: "adaptive.misconception.escalated",
      actorId: null, subjectType: "student", subjectId: e.studentId,
      metadata: { nodeId: e.nodeId, misconception: e.misconception, occurrences: e.occurrences },
    });
    // Notify the class Teacher, if the student's class has one.
    const enrolment = await this.store.getActiveEnrolmentForStudent(e.studentId);
    if (!enrolment) return;
    const teacherId = await this.classTeacherId(schoolId, enrolment.classId);
    if (!teacherId) return;
    await this.notifications.send({
      type: "alert.teacher",
      to: teacherId,
      subject: "A student needs your attention",
      body: "A persistent misconception was detected and needs a teaching decision.",
      context: { studentId: e.studentId, nodeId: e.nodeId, occurrences: e.occurrences },
    });
  }

  private async classTeacherId(schoolId: string, classId: string): Promise<string | null> {
    const teacher = (await this.store.listMembershipsBySchool(schoolId)).find(
      (m) => m.role === "teacher" && m.classId === classId,
    );
    return teacher?.userId ?? null;
  }

  private async classStudentIds(schoolId: string, classId: string): Promise<string[]> {
    return (await this.store.listMembershipsBySchool(schoolId))
      .filter((m) => m.role === "student" && m.classId === classId)
      .map((m) => m.userId);
  }
}
