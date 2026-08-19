import type { AgentSuggestion } from "../../domain/agent";
import type { AgentStore } from "../../ports/agentStore";

const clone = <T>(v: T): T => structuredClone(v);

export class InMemoryAgentStore implements AgentStore {
  private suggestions = new Map<string, AgentSuggestion>();

  async insertSuggestion(s: AgentSuggestion): Promise<void> { this.suggestions.set(s.id, clone(s)); }
  async getSuggestion(id: string): Promise<AgentSuggestion | undefined> {
    const v = this.suggestions.get(id);
    return v ? clone(v) : undefined;
  }
  async updateSuggestion(s: AgentSuggestion): Promise<void> { this.suggestions.set(s.id, clone(s)); }
  async deleteSuggestion(id: string): Promise<void> { this.suggestions.delete(id); }
  async listSuggestionsBySchool(schoolId: string): Promise<AgentSuggestion[]> {
    return [...this.suggestions.values()].filter((s) => s.schoolId === schoolId).map(clone);
  }
  async listSuggestionsByTeacher(teacherId: string): Promise<AgentSuggestion[]> {
    return [...this.suggestions.values()].filter((s) => s.teacherId === teacherId).map(clone);
  }
}
