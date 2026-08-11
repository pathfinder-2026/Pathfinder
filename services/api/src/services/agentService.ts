import {
  type AgentResult,
  type AgentSuggestion,
  type AgentSuggestionKind,
  type GroundingRef,
  type Observation,
  type SensitiveSection,
} from "../domain/agent";
import { ConflictError, NotFoundError } from "../domain/errors";
import type { AuditRecorder } from "../platform/audit/auditLog";
import type { AiServiceLayer } from "../platform/ai/aiServiceLayer";
import type { Clock } from "../platform/clock";
import { newId } from "../platform/ids";
import type { ActivityStore } from "../ports/activityStore";
import type { ContentStore } from "../ports/contentStore";
import type { DataStore } from "../ports/dataStore";
import type { SkillGraphStore } from "../ports/skillGraphStore";
import type { AgentStore } from "../ports/agentStore";
import type { ContentService } from "./contentService";

const DECLINE_MESSAGE =
  "No approved content grounds this request, so I won't invent an ungrounded plan. Upload and approve relevant content first.";

/**
 * Milestone 6 — Teacher Agent (FR-TAG-001–004). Grounds every suggestion in the
 * approved-content pool, declines honestly when there is none, and produces drafts
 * that persist unsent with sensitive material separated and flagged.
 */
export class AgentService {
  constructor(
    private readonly agents: AgentStore,
    private readonly ai: AiServiceLayer,
    private readonly content: ContentService,
    private readonly contentStore: ContentStore,
    private readonly graph: SkillGraphStore,
    private readonly activity: ActivityStore,
    private readonly store: DataStore,
    private readonly clock: Clock,
    private readonly audit: AuditRecorder,
  ) {}

  /** FR-TAG-001/002 — draft a unit sequence for a term, grounded in approved content. */
  async draftUnitSequence(teacherId: string, schoolId: string, input: { nodeId: string; term: string; topic?: string }): Promise<AgentResult> {
    return this.generateGrounded(teacherId, schoolId, "unit_sequence", input.nodeId, {
      title: `Unit sequence — ${input.term}`, term: input.term, topic: input.topic,
    });
  }

  /** FR-TAG-001/002 — draft a lesson plan; decline honestly with no grounding content. */
  async draftLessonPlan(teacherId: string, schoolId: string, input: { nodeId: string; topic?: string }): Promise<AgentResult> {
    return this.generateGrounded(teacherId, schoolId, "lesson_plan", input.nodeId, {
      title: `Lesson plan — ${input.topic ?? "topic"}`, topic: input.topic,
    });
  }

  /**
   * FR-TAG-001/002 — differentiated plan. When the class has no capability data
   * yet, produce a general plan and note it isn't personalised to real data.
   */
  async draftDifferentiation(teacherId: string, schoolId: string, input: { nodeId: string; classId: string; topic?: string }): Promise<AgentResult> {
    const hasCapabilityData = await this.classHasMastery(schoolId, input.classId);
    return this.generateGrounded(teacherId, schoolId, "differentiation", input.nodeId, {
      title: `Differentiation — ${input.topic ?? "topic"}`, topic: input.topic,
      personalised: hasCapabilityData,
      personalisationNote: hasCapabilityData ? null : "Not yet personalised to real student data — this class has no capability data yet.",
    });
  }

  /**
   * FR-TAG-003 — draft a parent progress summary. Behavioural/social observations
   * are separated from the academic body and flagged for extra teacher review; the
   * draft persists unsent and is never auto-sent.
   */
  async draftParentSummary(teacherId: string, schoolId: string, input: { studentId: string; nodeId: string; topic?: string; observations?: Observation[] }): Promise<AgentResult> {
    return this.generateGrounded(teacherId, schoolId, "parent_summary", input.nodeId, {
      title: "Parent progress summary", topic: input.topic, containsStudentData: true,
      observations: input.observations,
    });
  }

  /** FR-TAG-003 — draft student feedback (drafts only; never auto-sent). */
  async draftFeedback(teacherId: string, schoolId: string, input: { studentId: string; nodeId: string; topic?: string; observations?: Observation[] }): Promise<AgentResult> {
    return this.generateGrounded(teacherId, schoolId, "feedback", input.nodeId, {
      title: "Student feedback", topic: input.topic, containsStudentData: true,
      observations: input.observations,
    });
  }

  /** The Teacher edits a draft before sending (FR-TAG-003 happy path). */
  async editDraft(teacherId: string, suggestionId: string, content: string): Promise<AgentSuggestion> {
    const suggestion = await this.owned(teacherId, suggestionId);
    suggestion.content = content;
    suggestion.edited = true;
    await this.agents.updateSuggestion(suggestion);
    this.audit.append({ action: "agent.draft.edited", actorId: teacherId, subjectType: "agent_suggestion", subjectId: suggestion.id, metadata: {} });
    return suggestion;
  }

  /**
   * FR-TAG-004 — view a suggestion with its grounding sources resolved LIVE, so a
   * source archived after the fact still shows as a (now-archived) reference
   * rather than silently breaking the link.
   */
  async viewSuggestion(suggestionId: string): Promise<AgentSuggestion> {
    const suggestion = await this.agents.getSuggestion(suggestionId);
    if (!suggestion) throw new NotFoundError("Suggestion not found.");
    suggestion.grounding = await this.resolveGrounding(suggestion.grounding);
    return suggestion;
  }

  async listSuggestions(schoolId: string): Promise<AgentSuggestion[]> {
    const list = await this.agents.listSuggestionsBySchool(schoolId);
    for (const s of list) s.grounding = await this.resolveGrounding(s.grounding);
    return list;
  }

  // ---- core ----

  private async generateGrounded(
    teacherId: string,
    schoolId: string,
    kind: AgentSuggestionKind,
    nodeId: string,
    opts: {
      title: string; term?: string; topic?: string; containsStudentData?: boolean;
      personalised?: boolean; personalisationNote?: string | null; observations?: Observation[];
    },
  ): Promise<AgentResult> {
    await this.requireTeacher(teacherId, schoolId);

    // Grounding is mandatory. No approved source content → decline honestly
    // rather than inventing an ungrounded plan (FR-TAG-004 / DoD).
    const { refs, sources } = await this.grounding(schoolId, nodeId);
    if (refs.length === 0) {
      this.audit.append({ action: "agent.declined", actorId: teacherId, subjectType: "agent", subjectId: kind, metadata: { reason: "no_grounding_content", nodeId } });
      return { status: "declined", reason: "no_grounding_content", message: DECLINE_MESSAGE };
    }

    // Separate any behavioural/social observations from the academic body.
    const sensitiveSections: SensitiveSection[] = (opts.observations ?? [])
      .filter((o) => o.category !== "academic")
      .map((o) => ({ category: o.category as SensitiveSection["category"], text: o.text, flaggedForReview: true }));

    const completion = await this.ai.run(
      {
        purpose: "agent.generate",
        prompt: `Draft ${kind} grounded strictly in the approved sources.`,
        input: { kind, term: opts.term, topic: opts.topic ?? this.nodeTopic(nodeId), sources, personalised: opts.personalised ?? true },
        containsStudentData: opts.containsStudentData ?? false,
      },
      teacherId,
    );

    const suggestion: AgentSuggestion = {
      id: newId(), schoolId, teacherId, kind, title: opts.title, content: completion.text,
      grounding: refs, sensitiveSections, requiresExtraReview: sensitiveSections.length > 0,
      personalised: opts.personalised ?? true,
      personalisationNote: opts.personalisationNote ?? null,
      sent: false, sentAt: null, edited: false, createdAt: this.clock.isoNow(),
    };
    await this.agents.insertSuggestion(suggestion);
    this.audit.append({
      action: "agent.suggested", actorId: teacherId, subjectType: "agent_suggestion", subjectId: suggestion.id,
      metadata: { kind, groundingCount: refs.length, requiresExtraReview: suggestion.requiresExtraReview, personalised: suggestion.personalised },
    });
    return { status: "suggested", suggestion };
  }

  /** Approved content mapped to a node → grounding refs (snapshot) + source texts. */
  private async grounding(schoolId: string, nodeId: string): Promise<{ refs: GroundingRef[]; sources: string[] }> {
    const pool = await this.content.approvedPool(schoolId);
    const refs: GroundingRef[] = [];
    const sources: string[] = [];
    for (const item of pool) {
      const mapped = (await this.graph.listMappingsByContent(item.id)).some((m) => m.nodeId === nodeId);
      if (!mapped) continue;
      refs.push({ contentItemId: item.id, title: item.title, archived: false });
      sources.push(item.title);
    }
    return { refs, sources };
  }

  /** Re-resolve the archived flag of each grounding ref, retaining the reference. */
  private async resolveGrounding(refs: GroundingRef[]): Promise<GroundingRef[]> {
    const out: GroundingRef[] = [];
    for (const ref of refs) {
      const item = await this.contentStore.getContentItem(ref.contentItemId);
      // Keep the reference even if the item is archived (or gone) — never break it.
      out.push({ ...ref, archived: item ? item.archived : true });
    }
    return out;
  }

  private async classHasMastery(schoolId: string, classId: string): Promise<boolean> {
    const studentIds = new Set(
      (await this.store.listMembershipsBySchool(schoolId))
        .filter((m) => m.role === "student" && m.classId === classId)
        .map((m) => m.userId),
    );
    if (studentIds.size === 0) return false;
    return (await this.activity.listMasteryBySchool(schoolId)).some((r) => studentIds.has(r.studentId));
  }

  private nodeTopic(nodeId: string): string {
    return nodeId; // resolved to a label by the caller/UI; the id keeps it deterministic
  }

  private async owned(teacherId: string, suggestionId: string): Promise<AgentSuggestion> {
    const suggestion = await this.agents.getSuggestion(suggestionId);
    if (!suggestion) throw new NotFoundError("Suggestion not found.");
    if (suggestion.teacherId !== teacherId) {
      throw new ConflictError("NOT_OWNER", "Only the drafting teacher may edit this draft.");
    }
    return suggestion;
  }

  private async requireTeacher(actorId: string, schoolId: string): Promise<void> {
    const memberships = await this.store.listMembershipsByUser(actorId);
    if (!memberships.some((m) => m.schoolId === schoolId && m.role === "teacher")) {
      throw new ConflictError("NOT_A_TEACHER", "Only a Teacher may use the Teacher Agent.");
    }
  }
}
