import type { AgentSuggestion, GroundingRef, SensitiveSection, AgentSuggestionKind } from "../../domain/agent";
import type { AgentStore } from "../../ports/agentStore";
import { iso, isoOrNull, type Sql } from "./pgClient";

/** PostgreSQL AgentStore adapter (ap-southeast-2). */
export class PgAgentStore implements AgentStore {
  constructor(private readonly sql: Sql) {}

  async insertSuggestion(s: AgentSuggestion): Promise<void> {
    await this.sql`insert into agent_suggestions
      (id,school_id,teacher_id,kind,title,content,grounding,sensitive_sections,requires_extra_review,
       personalised,personalisation_note,sent,sent_at,created_at)
      values (${s.id},${s.schoolId},${s.teacherId},${s.kind},${s.title},${s.content},
        ${this.sql.json(s.grounding as never)},${this.sql.json(s.sensitiveSections as never)},${s.requiresExtraReview},
        ${s.personalised},${s.personalisationNote},${s.sent},${s.sentAt},${s.createdAt})`;
  }
  async updateSuggestion(s: AgentSuggestion): Promise<void> {
    await this.sql`update agent_suggestions set title=${s.title},content=${s.content},
      grounding=${this.sql.json(s.grounding as never)},sensitive_sections=${this.sql.json(s.sensitiveSections as never)},
      requires_extra_review=${s.requiresExtraReview},personalised=${s.personalised},
      personalisation_note=${s.personalisationNote},sent=${s.sent},sent_at=${s.sentAt} where id=${s.id}`;
  }
  async getSuggestion(id: string): Promise<AgentSuggestion | undefined> {
    const rows = await this.sql`select * from agent_suggestions where id=${id}`;
    return rows[0] ? mapSuggestion(rows[0]) : undefined;
  }
  async listSuggestionsBySchool(schoolId: string): Promise<AgentSuggestion[]> {
    return (await this.sql`select * from agent_suggestions where school_id=${schoolId}`).map(mapSuggestion);
  }
  async listSuggestionsByTeacher(teacherId: string): Promise<AgentSuggestion[]> {
    return (await this.sql`select * from agent_suggestions where teacher_id=${teacherId}`).map(mapSuggestion);
  }
}

type Row = Record<string, any>;
function mapSuggestion(r: Row): AgentSuggestion {
  return {
    id: r.id, schoolId: r.school_id, teacherId: r.teacher_id, kind: r.kind as AgentSuggestionKind,
    title: r.title, content: r.content,
    grounding: r.grounding as GroundingRef[], sensitiveSections: r.sensitive_sections as SensitiveSection[],
    requiresExtraReview: r.requires_extra_review, personalised: r.personalised,
    personalisationNote: r.personalisation_note, sent: r.sent, sentAt: isoOrNull(r.sent_at),
    createdAt: iso(r.created_at),
  };
}
