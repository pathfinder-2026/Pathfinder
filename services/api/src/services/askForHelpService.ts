import {
  classifyHelpMessage,
  taskKeywords,
  type HelpMessage,
  type HelpResponseKind,
  type HelpResult,
  type HelpSession,
} from "../domain/askForHelp";
import { ConflictError, NotFoundError } from "../domain/errors";
import type { AuditRecorder } from "../platform/audit/auditLog";
import type { AiServiceLayer } from "../platform/ai/aiServiceLayer";
import type { Clock } from "../platform/clock";
import type { NotificationService } from "../platform/notifications/notificationService";
import { newId } from "../platform/ids";
import type { AssessmentStore } from "../ports/assessmentStore";
import type { ContentStore } from "../ports/contentStore";
import type { DataStore } from "../ports/dataStore";
import type { SkillGraphStore } from "../ports/skillGraphStore";
import type { WorkspaceStore } from "../ports/workspaceStore";
import type { ContentService } from "./contentService";

/**
 * Milestone 7 — Ask for Help (FR-STU-002 / FR-SAG-001 / FR-SAG-002). The
 * task-gated tutor, with STATE-LAYER safety:
 *   - Unavailable for a school with no safeguarding contact + SLA configured.
 *   - Locked out for assessment tasks and while any assessment is in progress —
 *     decided from task/attempt STATE before any AI call, never prompt-instructed.
 *   - Grounded hints only; the model is never given "the answer".
 *   - Off-topic / direct-answer / unsafe / safeguarding handled by deterministic
 *     classifiers (see domain/askForHelp), all logged.
 *   - Transcripts are visible to the assigning teacher, NEVER to a Principal.
 */
export class AskForHelpService {
  constructor(
    private readonly workspace: WorkspaceStore,
    private readonly store: DataStore,
    private readonly assessments: AssessmentStore,
    private readonly content: ContentService,
    private readonly contentStore: ContentStore,
    private readonly graph: SkillGraphStore,
    private readonly ai: AiServiceLayer,
    private readonly clock: Clock,
    private readonly audit: AuditRecorder,
    private readonly notifications: NotificationService,
  ) {}

  async ask(studentId: string, taskId: string, message: string): Promise<HelpResult> {
    const task = await this.workspace.getTask(taskId);
    if (!task || task.studentId !== studentId) throw new NotFoundError("Task not found for this student.");

    // ---- HARD PRECONDITION: safeguarding must be configured for the school ----
    const config = await this.store.getSafeguardingConfig(task.schoolId);
    if (!config) {
      return {
        available: false, reason: "safeguarding_not_configured",
        message: "Ask for Help isn’t available yet — your school hasn’t finished safeguarding setup.",
      };
    }

    // ---- STATE-LAYER LOCKOUT (never prompt-based) ----
    if (task.type === "assessment") {
      return { available: false, reason: "not_homework_or_practice", message: "Ask for Help is only for homework and practice, not assessments." };
    }
    const midAssessment = (await this.assessments.listAttemptsByStudent(studentId)).some((a) => a.status === "in_progress");
    if (midAssessment) {
      return { available: false, reason: "assessment_in_progress", message: "Ask for Help is turned off during an assessment. It’ll be back when you finish." };
    }

    // ---- classify (deterministic) BEFORE any model call ----
    const keywords = taskKeywords(task.title);
    const classification = classifyHelpMessage(message, keywords);

    const session = await this.ensureSession(task.schoolId, studentId, taskId, task.teacherId);
    await this.record(session.id, "student", message, mapKind(classification));

    let kind: HelpResponseKind;
    let reply: string;
    switch (classification) {
      case "safeguarding": {
        kind = "safeguarding";
        reply = `It sounds like something serious. You’re not in trouble — I’ve let ${config.contactName} (${config.contactRole}) know so a trusted adult can help.`;
        this.audit.append({ action: "safeguarding.escalated", actorId: null, subjectType: "student", subjectId: studentId, metadata: { taskId, slaHours: config.slaHours } });
        await this.notifications.send({
          type: "alert.safeguarding", to: config.contactName, subject: "Safeguarding: a student may need support",
          body: "An Ask for Help message triggered the safeguarding classifier. Please follow the disclosure workflow.",
          context: { studentId, schoolId: task.schoolId, slaHours: config.slaHours },
        });
        break;
      }
      case "blocked_safety": {
        kind = "blocked_safety";
        reply = "I can’t help with that here, and I can’t give medical or diagnostic opinions. If you’re worried, please talk to your teacher.";
        this.audit.append({ action: "help.safety.blocked", actorId: null, subjectType: "student", subjectId: studentId, metadata: { taskId } });
        break;
      }
      case "declined_direct_answer": {
        kind = "declined_direct_answer";
        reply = "I won’t give you the answer — that part’s your learning to do. Here’s a nudge: try the first step and check it against your task’s materials.";
        break;
      }
      case "declined_offtopic": {
        kind = "declined_offtopic";
        reply = `Let’s stay on your current task — “${task.title}”. Ask me about that and I’ll help you get unstuck.`;
        break;
      }
      default: {
        kind = "hint";
        const chunk = await this.groundingChunk(task.schoolId, task.nodeId);
        const completion = await this.ai.run(
          { purpose: "help.hint", prompt: "Give a scoped hint, never the answer.", input: { chunk, topic: task.title }, containsStudentData: true },
          studentId,
        );
        reply = completion.text;
      }
    }

    await this.record(session.id, "assistant", reply, kind);
    return { available: true, kind, message: reply };
  }

  /**
   * FR-SAG-002 — the transcript is visible to the ASSIGNING teacher only, and
   * NEVER to a Principal.
   */
  async transcript(viewerId: string, sessionId: string): Promise<HelpMessage[]> {
    const session = await this.workspace.getHelpSession(sessionId);
    if (!session) throw new NotFoundError("Help session not found.");
    const roles = (await this.store.listMembershipsByUser(viewerId)).map((m) => m.role);
    if (roles.includes("principal")) {
      throw new ConflictError("PRINCIPAL_FORBIDDEN", "Ask for Help transcripts are never visible to a Principal.");
    }
    if (viewerId !== session.teacherId) {
      throw new ConflictError("NOT_ASSIGNING_TEACHER", "Only the assigning teacher may view this transcript.");
    }
    this.audit.append({ action: "help.transcript.viewed", actorId: viewerId, subjectType: "help_session", subjectId: sessionId, metadata: {} });
    return this.workspace.listHelpMessages(sessionId);
  }

  // ---- helpers ----

  private async ensureSession(schoolId: string, studentId: string, taskId: string, teacherId: string): Promise<HelpSession> {
    const existing = await this.workspace.findHelpSession(studentId, taskId);
    if (existing) return existing;
    const session: HelpSession = { id: newId(), schoolId, studentId, taskId, teacherId, createdAt: this.clock.isoNow() };
    await this.workspace.insertHelpSession(session);
    return session;
  }

  private async record(sessionId: string, role: "student" | "assistant", text: string, kind: HelpResponseKind): Promise<void> {
    await this.workspace.insertHelpMessage({ id: newId(), sessionId, role, text, kind, createdAt: this.clock.isoNow() });
  }

  /** The first approved-content chunk mapped to the task's skill (grounding, not an answer). */
  private async groundingChunk(schoolId: string, nodeId: string | null): Promise<string> {
    if (!nodeId) return "";
    for (const item of await this.content.approvedPool(schoolId)) {
      const mapped = (await this.graph.listMappingsByContent(item.id)).some((m) => m.nodeId === nodeId);
      if (!mapped) continue;
      const chunk = (await this.contentStore.listChunksByVersion(item.currentVersionId))[0];
      if (chunk) return `${chunk.heading} ${chunk.text}`;
    }
    return "";
  }
}

/** Student-message kind mirrors how the assistant handled it (for the transcript). */
function mapKind(c: ReturnType<typeof classifyHelpMessage>): HelpResponseKind {
  return c === "proceed" ? "hint" : c;
}
