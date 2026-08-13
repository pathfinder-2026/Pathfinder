import type { HelpMessage, HelpSession } from "../domain/askForHelp";
import type { CalendarEvent, StudentTask } from "../domain/studentWorkspace";

/**
 * Persistence port for the Milestone 7 student workspace: tasks, calendar events,
 * and Ask-for-Help transcripts. Two adapter families satisfy it (in-memory + pg).
 */
export interface WorkspaceStore {
  insertTask(t: StudentTask): Promise<void>;
  getTask(id: string): Promise<StudentTask | undefined>;
  updateTask(t: StudentTask): Promise<void>;
  listTasksByStudent(studentId: string): Promise<StudentTask[]>;
  listTasksByTeacher(teacherId: string): Promise<StudentTask[]>;

  insertEvent(e: CalendarEvent): Promise<void>;
  getEvent(id: string): Promise<CalendarEvent | undefined>;
  updateEvent(e: CalendarEvent): Promise<void>;
  listEventsBySchool(schoolId: string): Promise<CalendarEvent[]>;

  insertHelpSession(s: HelpSession): Promise<void>;
  getHelpSession(id: string): Promise<HelpSession | undefined>;
  /** Handover (FR-ADM-002 cover): transfers session ownership with its task. */
  updateHelpSession(s: HelpSession): Promise<void>;
  findHelpSession(studentId: string, taskId: string): Promise<HelpSession | undefined>;
  insertHelpMessage(m: HelpMessage): Promise<void>;
  listHelpMessages(sessionId: string): Promise<HelpMessage[]>;
  /** Retention (M11): delete help messages created before `iso`; returns the count. */
  deleteHelpMessagesBefore(iso: string): Promise<number>;
}
