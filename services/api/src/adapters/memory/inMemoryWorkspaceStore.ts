import type { HelpMessage, HelpSession } from "../../domain/askForHelp";
import type { CalendarEvent, StudentTask } from "../../domain/studentWorkspace";
import type { WorkspaceStore } from "../../ports/workspaceStore";

const clone = <T>(v: T): T => structuredClone(v);

export class InMemoryWorkspaceStore implements WorkspaceStore {
  private tasks = new Map<string, StudentTask>();
  private events = new Map<string, CalendarEvent>();
  private sessions = new Map<string, HelpSession>();
  private messages = new Map<string, HelpMessage>();

  async insertTask(t: StudentTask): Promise<void> { this.tasks.set(t.id, clone(t)); }
  async getTask(id: string): Promise<StudentTask | undefined> { const v = this.tasks.get(id); return v ? clone(v) : undefined; }
  async updateTask(t: StudentTask): Promise<void> { this.tasks.set(t.id, clone(t)); }
  async listTasksByStudent(studentId: string): Promise<StudentTask[]> {
    return [...this.tasks.values()].filter((t) => t.studentId === studentId).map(clone);
  }
  async listTasksByTeacher(teacherId: string): Promise<StudentTask[]> {
    return [...this.tasks.values()].filter((t) => t.teacherId === teacherId).map(clone);
  }

  async insertEvent(e: CalendarEvent): Promise<void> { this.events.set(e.id, clone(e)); }
  async getEvent(id: string): Promise<CalendarEvent | undefined> { const v = this.events.get(id); return v ? clone(v) : undefined; }
  async updateEvent(e: CalendarEvent): Promise<void> { this.events.set(e.id, clone(e)); }
  async listEventsBySchool(schoolId: string): Promise<CalendarEvent[]> {
    return [...this.events.values()].filter((e) => e.schoolId === schoolId).map(clone);
  }

  async insertHelpSession(s: HelpSession): Promise<void> { this.sessions.set(s.id, clone(s)); }
  async getHelpSession(id: string): Promise<HelpSession | undefined> { const v = this.sessions.get(id); return v ? clone(v) : undefined; }
  async findHelpSession(studentId: string, taskId: string): Promise<HelpSession | undefined> {
    const v = [...this.sessions.values()].find((s) => s.studentId === studentId && s.taskId === taskId);
    return v ? clone(v) : undefined;
  }
  async insertHelpMessage(m: HelpMessage): Promise<void> { this.messages.set(m.id, clone(m)); }
  async listHelpMessages(sessionId: string): Promise<HelpMessage[]> {
    return [...this.messages.values()]
      .filter((m) => m.sessionId === sessionId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(clone);
  }
  async deleteHelpMessagesBefore(iso: string): Promise<number> {
    let deleted = 0;
    for (const [id, m] of this.messages) if (m.createdAt < iso) { this.messages.delete(id); deleted += 1; }
    return deleted;
  }
}
