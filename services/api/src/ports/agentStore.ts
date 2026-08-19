import type { AgentSuggestion } from "../domain/agent";

/** Persistence port for Milestone 6 Teacher-Agent suggestions/drafts. */
export interface AgentStore {
  insertSuggestion(s: AgentSuggestion): Promise<void>;
  getSuggestion(id: string): Promise<AgentSuggestion | undefined>;
  updateSuggestion(s: AgentSuggestion): Promise<void>;
  deleteSuggestion(id: string): Promise<void>;
  listSuggestionsBySchool(schoolId: string): Promise<AgentSuggestion[]>;
  listSuggestionsByTeacher(teacherId: string): Promise<AgentSuggestion[]>;
}
