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
import { graphOfNode } from "./curriculumScope";
import { GroundingIndex, relevance } from "./grounding";

const DECLINE_MESSAGE =
  "No approved content grounds this request, so I won't invent an ungrounded plan. Upload and approve relevant content first.";

/**
 * The concept(s) a draft is about. Multi-select is the point of #19 — a lesson
 * plan usually spans several concepts — but `nodeId` stays accepted so every
 * existing caller keeps working without a coordinated deploy.
 */
export interface AgentTarget {
  nodeId?: string;
  nodeIds?: string[];
}

/** The concepts an agent request targets, deduped, in the teacher's order. */
function targetNodes(target: AgentTarget): string[] {
  const ids = target.nodeIds?.length ? target.nodeIds : target.nodeId ? [target.nodeId] : [];
  return [...new Set(ids.filter((id) => !!id))];
}

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
  async draftUnitSequence(teacherId: string, schoolId: string, input: AgentTarget & { term: string; topic?: string }): Promise<AgentResult> {
    return this.generateGrounded(teacherId, schoolId, "unit_sequence", targetNodes(input), {
      title: `Unit sequence — ${input.term}`, term: input.term, topic: input.topic,
    });
  }

  /** FR-TAG-001/002 — draft a lesson plan; decline honestly with no grounding content. */
  async draftLessonPlan(teacherId: string, schoolId: string, input: AgentTarget & { topic?: string }): Promise<AgentResult> {
    return this.generateGrounded(teacherId, schoolId, "lesson_plan", targetNodes(input), {
      title: `Lesson plan — ${input.topic ?? "topic"}`, topic: input.topic,
    });
  }

  /**
   * FR-TAG-001/002 — differentiated plan. When the class has no capability data
   * yet, produce a general plan and note it isn't personalised to real data.
   */
  async draftDifferentiation(teacherId: string, schoolId: string, input: AgentTarget & { classId: string; topic?: string }): Promise<AgentResult> {
    const hasCapabilityData = await this.classHasMastery(schoolId, input.classId);
    return this.generateGrounded(teacherId, schoolId, "differentiation", targetNodes(input), {
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
  async draftParentSummary(teacherId: string, schoolId: string, input: AgentTarget & { studentId: string; topic?: string; observations?: Observation[] }): Promise<AgentResult> {
    return this.generateGrounded(teacherId, schoolId, "parent_summary", targetNodes(input), {
      title: "Parent progress summary", topic: input.topic, containsStudentData: true,
      observations: input.observations,
    });
  }

  /** FR-TAG-003 — draft student feedback (drafts only; never auto-sent). */
  async draftFeedback(teacherId: string, schoolId: string, input: AgentTarget & { studentId: string; topic?: string; observations?: Observation[] }): Promise<AgentResult> {
    return this.generateGrounded(teacherId, schoolId, "feedback", targetNodes(input), {
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
    nodeIds: string[],
    opts: {
      title: string; term?: string; topic?: string; containsStudentData?: boolean;
      personalised?: boolean; personalisationNote?: string | null; observations?: Observation[];
    },
  ): Promise<AgentResult> {
    await this.requireTeacher(teacherId, schoolId);

    // Grounding is mandatory. No approved source content → decline honestly
    // rather than inventing an ungrounded plan (FR-TAG-004 / DoD).
    // Concept labels + the teacher's own topic words steer WHICH sections of
    // each source are sent (see grounding()'s relevance ranking).
    const conceptLabels = await this.nodeTopic(schoolId, nodeIds);
    const topic = opts.topic ?? conceptLabels;
    const { refs, sources } = await this.grounding(schoolId, nodeIds, `${topic} ${conceptLabels}`);
    if (refs.length === 0) {
      this.audit.append({ action: "agent.declined", actorId: teacherId, subjectType: "agent", subjectId: kind, metadata: { reason: "no_grounding_content", nodeIds } });
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
        input: { kind, term: opts.term, topic, sources, personalised: opts.personalised ?? true },
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

  /**
   * Approved content grounding the chosen concepts → grounding refs (snapshot) +
   * the sources with their ACTUAL TEXT. Reaches material filed against an
   * ancestor (subject/strand) at the nearest mapped level, the same rule
   * assessment generation uses — see GroundingIndex.
   *
   * The text matters: this used to send titles alone, and the remote prompt
   * (correctly) forbids inventing beyond the supplied sources — so in
   * production the model refused, and the refusal was saved as the "draft".
   * The local provider's canned template hid this in every test. Text is
   * budgeted per source and overall so a 50k-char syllabus doesn't swamp the
   * request; every grounding item still appears as a ref even when the text
   * budget is spent.
   */
  private async grounding(
    schoolId: string,
    nodeIds: string[],
    query: string,
  ): Promise<{ refs: GroundingRef[]; sources: { title: string; text: string }[] }> {
    const index = await GroundingIndex.build(this.graph, schoolId, await this.content.approvedPool(schoolId));
    const refs: GroundingRef[] = [];
    const sources: { title: string; text: string }[] = [];
    let budget = 24000; // chars across all sources
    for (const { item } of index.sourcesForAny(nodeIds)) {
      refs.push({ contentItemId: item.id, title: item.title, archived: false });
      if (budget <= 0) continue;
      const chunks = await this.contentStore.listChunksByVersion(item.currentVersionId);
      // Sections most relevant to what's being drafted go in FIRST. Sending a
      // big document in page order spent the whole budget on its front matter
      // (copyright, acknowledgements, contents) — the model then refused,
      // accurately, for want of any actual subject content. Ties and no-signal
      // chunks keep document order.
      const ranked = [...chunks]
        .sort((a, b) => a.order - b.order)
        .map((c, i) => ({ text: `${c.heading}\n${c.text}`, i, score: relevance(`${c.heading} ${c.text}`, query) }))
        .sort((a, b) => b.score - a.score || a.i - b.i);
      let text = "";
      const cap = Math.min(8000, budget);
      for (const c of ranked) {
        if (text.length >= cap) break;
        text += (text ? "\n\n" : "") + c.text.slice(0, cap - text.length);
      }
      sources.push({ title: item.title, text });
      budget -= text.length;
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

  /**
   * The chosen skills' human labels for draft text. This used to return the raw
   * node id, which the UI never resolved — so teachers read drafts saying
   * 'a lesson plan on "skill-add-fractions"'. Falls back to the id only if a
   * node genuinely isn't in a signed-off graph.
   */
  private async nodeTopic(schoolId: string, nodeIds: string[]): Promise<string> {
    const labels: string[] = [];
    for (const nodeId of nodeIds) {
      const version = await graphOfNode(this.graph, schoolId, nodeId);
      const node = version ? await this.graph.getNode(version.id, nodeId) : undefined;
      labels.push(node?.label ?? nodeId);
    }
    return labels.join(", ");
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
