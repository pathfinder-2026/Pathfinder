import { AuthError, ConflictError, NotFoundError } from "../domain/errors";
import { masteryLevel } from "../domain/mastery";
import {
  containsDiagnosticLanguage,
  plainTopic,
  type ParentChildLink,
  type ParentSummary,
} from "../domain/parent";
import type { CalendarItemView } from "../domain/studentWorkspace";
import type { AuditRecorder } from "../platform/audit/auditLog";
import type { AiServiceLayer } from "../platform/ai/aiServiceLayer";
import type { Clock } from "../platform/clock";
import type { NotificationService } from "../platform/notifications/notificationService";
import { newId } from "../platform/ids";
import type { ActivityStore } from "../ports/activityStore";
import type { DataStore } from "../ports/dataStore";
import type { ParentStore } from "../ports/parentStore";
import type { SkillGraphStore } from "../ports/skillGraphStore";
import type { WorkspaceStore } from "../ports/workspaceStore";

const DAY_MS = 24 * 60 * 60 * 1000;
const REPORTING_DAYS = 30;

export interface DigestResult {
  sent: number;
  skippedNoActivity: number;
}

/**
 * Milestone 8 — Parent Dashboard (FR-PAR-001/003/004/005/006). A verified parent
 * sees plain-language, non-diagnostic progress for their OWN child only — never
 * another student, never merged across their children, and nothing at all until
 * the link is verified.
 */
export class ParentService {
  constructor(
    private readonly parents: ParentStore,
    private readonly store: DataStore,
    private readonly activity: ActivityStore,
    private readonly workspace: WorkspaceStore,
    private readonly graph: SkillGraphStore,
    private readonly ai: AiServiceLayer,
    private readonly clock: Clock,
    private readonly audit: AuditRecorder,
    private readonly notifications: NotificationService,
  ) {}

  /** A School Admin links a parent to a real (non-synthetic) child — unverified. */
  async linkChild(actorId: string, schoolId: string, input: { parentId: string; studentId: string; relationship: string }): Promise<ParentChildLink> {
    await this.requireAdmin(actorId, schoolId);
    const child = await this.store.getUser(input.studentId);
    if (!child || child.synthetic) throw new ConflictError("INVALID_CHILD", "Can only link a real student.");
    const isStudent = (await this.store.listMembershipsByUser(input.studentId)).some((m) => m.schoolId === schoolId && m.role === "student");
    if (!isStudent) throw new ConflictError("INVALID_CHILD", "That user is not a student at this school.");
    const link: ParentChildLink = {
      id: newId(), schoolId, parentId: input.parentId, studentId: input.studentId,
      relationship: input.relationship, verified: false, verifiedAt: null, lastDigestAt: null,
      createdAt: this.clock.isoNow(),
    };
    await this.parents.insertLink(link);
    this.audit.append({ action: "parent.link.created", actorId, subjectType: "parent_link", subjectId: link.id, metadata: { verified: false } });
    return link;
  }

  /** Verification completes the relationship — data only flows after this. */
  async verifyLink(actorId: string, schoolId: string, linkId: string): Promise<ParentChildLink> {
    await this.requireAdmin(actorId, schoolId);
    const link = await this.parents.getLink(linkId);
    if (!link) throw new NotFoundError("Parent link not found.");
    link.verified = true;
    link.verifiedAt = this.clock.isoNow();
    await this.parents.updateLink(link);
    this.audit.append({ action: "parent.link.verified", actorId, subjectType: "parent_link", subjectId: link.id, metadata: {} });
    return link;
  }

  /** The parent's VERIFIED children (each kept separate — never merged). */
  async verifiedChildren(parentId: string): Promise<{ studentId: string; childName: string | null; yearGroup: string | null }[]> {
    const links = (await this.parents.listLinksByParent(parentId)).filter((l) => l.verified);
    const out = [];
    for (const l of links) {
      out.push({ studentId: l.studentId, childName: await this.childName(l.studentId), yearGroup: await this.studentYearGroup(l.studentId) });
    }
    return out;
  }

  /** FR-PAR-001/003 — the plain-language, non-diagnostic dashboard for ONE verified child. */
  async dashboardFor(parentId: string, studentId: string): Promise<ParentSummary> {
    const link = await this.requireVerified(parentId, studentId);
    const nowIso = this.clock.isoNow();
    const since = new Date(this.clock.now().getTime() - REPORTING_DAYS * DAY_MS).toISOString();

    const mastery = (await this.activity.listMasteryBySchool(link.schoolId)).filter((m) => m.studentId === studentId);
    const recentMastery = mastery.filter((m) => m.lastActivityAt >= since);
    const completedTasks = (await this.workspace.listTasksByStudent(studentId))
      .filter((t) => t.status === "completed" && (t.completedAt ?? "") >= since);

    const childName = await this.childName(studentId);
    if (recentMastery.length === 0 && completedTasks.length === 0) {
      return {
        childName, hasRecentActivity: false, strengths: [], focusAreas: [], recentActivity: [],
        summaryText: `There's no new activity to report for ${childName ?? "your child"} in the last ${REPORTING_DAYS} days.`,
        period: `${since.slice(0, 10)} to ${nowIso.slice(0, 10)}`,
      };
    }

    const labels = await this.nodeLabels(link.schoolId);
    const topic = (nodeId: string) => plainTopic(labels.get(nodeId) ?? nodeId);
    const strengths = dedupe(recentMastery.filter((m) => masteryLevel(m.score) === "secure").map((m) => topic(m.nodeId)));
    const focusAreas = dedupe(recentMastery.filter((m) => masteryLevel(m.score) !== "secure").map((m) => topic(m.nodeId)));
    const recentActivity = [
      ...(completedTasks.length ? [`completed ${completedTasks.length} task${completedTasks.length === 1 ? "" : "s"}`] : []),
      ...(recentMastery.length ? [`practised ${dedupe(recentMastery.map((m) => topic(m.nodeId))).length} topic${recentMastery.length === 1 ? "" : "s"}`] : []),
    ];

    const completion = await this.ai.run(
      { purpose: "parent.summary", prompt: "Plain-language, observational, non-diagnostic parent summary.", input: { name: childName, strengths, focusAreas, activity: recentActivity }, containsStudentData: true },
      parentId,
    );
    // DoD guard: a parent summary must NEVER contain diagnostic/clinical language.
    const summaryText = containsDiagnosticLanguage(completion.text)
      ? `${childName ?? "Your child"} is making progress; some topics need more practice. Please speak with the teacher for details.`
      : completion.text;

    return { childName, hasRecentActivity: true, strengths, focusAreas, recentActivity, summaryText, period: `${since.slice(0, 10)} to ${nowIso.slice(0, 10)}` };
  }

  /** FR-PAR-006 — the verified child's calendar (year-group-scoped, kept per-child). */
  async calendarFor(parentId: string, studentId: string): Promise<CalendarItemView[]> {
    const link = await this.requireVerified(parentId, studentId);
    const yearGroup = await this.studentYearGroup(studentId);
    const items: CalendarItemView[] = [];
    for (const e of await this.workspace.listEventsBySchool(link.schoolId)) {
      if (e.yearGroup !== null && e.yearGroup !== yearGroup) continue; // restricted to another year group → invisible
      items.push({ id: e.id, title: e.title, type: e.type, date: e.eventDate, changed: e.changed });
    }
    return items.sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * FR-PAR-004 — the single weekly consolidated cadence. One notification per
   * parent-child with new progress activity since the last digest; NONE when there
   * is nothing to report. Safeguarding items are NOT here — they escalate
   * immediately via FR-SAF-002, independent of this cadence.
   */
  async runWeeklyDigest(schoolId: string, asOfIso?: string): Promise<DigestResult> {
    const asOf = asOfIso ?? this.clock.isoNow();
    const links = (await this.parents.listLinksBySchool(schoolId)).filter((l) => l.verified);
    let sent = 0;
    let skippedNoActivity = 0;
    for (const link of links) {
      const since = link.lastDigestAt ?? new Date(new Date(asOf).getTime() - 7 * DAY_MS).toISOString();
      const mastery = (await this.activity.listMasteryBySchool(schoolId)).filter((m) => m.studentId === link.studentId && m.lastActivityAt > since && m.lastActivityAt <= asOf);
      const completed = (await this.workspace.listTasksByStudent(link.studentId)).filter((t) => t.status === "completed" && (t.completedAt ?? "") > since && (t.completedAt ?? "") <= asOf);
      const itemCount = mastery.length + completed.length;

      if (itemCount > 0) {
        await this.notifications.send({
          type: "parent.digest", to: link.parentId, subject: "Your child's weekly update",
          body: `A consolidated summary of ${itemCount} update${itemCount === 1 ? "" : "s"} from the past week.`,
          context: { studentId: link.studentId, items: itemCount },
        });
        sent += 1;
      } else {
        skippedNoActivity += 1;
      }
      link.lastDigestAt = asOf;
      await this.parents.updateLink(link);
    }
    return { sent, skippedNoActivity };
  }

  // ---- helpers ----

  private async requireVerified(parentId: string, studentId: string): Promise<ParentChildLink> {
    const link = await this.parents.findLink(parentId, studentId);
    if (!link || !link.verified) {
      // Cross-student access and unverified relationships both land here: no data.
      throw new AuthError("No verified relationship to this student.");
    }
    return link;
  }

  private async requireAdmin(actorId: string, schoolId: string): Promise<void> {
    const memberships = await this.store.listMembershipsByUser(actorId);
    if (!memberships.some((m) => m.schoolId === schoolId && m.role === "admin")) {
      throw new ConflictError("NOT_AN_ADMIN", "Only a School Admin may manage parent links.");
    }
  }

  private async childName(studentId: string): Promise<string | null> {
    const pd = await this.store.getPersonalData(studentId);
    return pd ? pd.firstName : null;
  }

  private async studentYearGroup(studentId: string): Promise<string | null> {
    const m = (await this.store.listMembershipsByUser(studentId)).find((mm) => mm.role === "student" && mm.classId);
    if (!m?.classId) return null;
    return (await this.store.getClass(m.classId))?.yearGroup ?? null;
  }

  private async nodeLabels(schoolId: string): Promise<Map<string, string>> {
    const config = await this.graph.getSchoolCurriculum(schoolId);
    const version = await this.graph.latestSignedOffVersion(config?.curriculum ?? "NSW");
    const map = new Map<string, string>();
    if (!version) return map;
    for (const n of await this.graph.listNodes(version.id)) map.set(n.id, n.label);
    return map;
  }
}

function dedupe(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}
