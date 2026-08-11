import type { HelpMessage, HelpMessageRole, HelpResponseKind, HelpSession } from "../../domain/askForHelp";
import type { CalendarEvent, CalendarEventType, StudentTask, TaskStatus, TaskType } from "../../domain/studentWorkspace";
import type { WorkspaceStore } from "../../ports/workspaceStore";
import { iso, isoOrNull, type Sql } from "./pgClient";

/** PostgreSQL WorkspaceStore adapter (ap-southeast-2). */
export class PgWorkspaceStore implements WorkspaceStore {
  constructor(private readonly sql: Sql) {}

  async insertTask(t: StudentTask): Promise<void> {
    await this.sql`insert into student_tasks
      (id,school_id,student_id,class_id,teacher_id,type,title,node_id,assessment_id,due_date,status,completed_at,overdue_notified,created_at)
      values (${t.id},${t.schoolId},${t.studentId},${t.classId},${t.teacherId},${t.type},${t.title},${t.nodeId},
        ${t.assessmentId},${t.dueDate},${t.status},${t.completedAt},${t.overdueNotified},${t.createdAt})`;
  }
  async updateTask(t: StudentTask): Promise<void> {
    await this.sql`update student_tasks set title=${t.title},due_date=${t.dueDate},status=${t.status},
      completed_at=${t.completedAt},overdue_notified=${t.overdueNotified} where id=${t.id}`;
  }
  async getTask(id: string): Promise<StudentTask | undefined> {
    const rows = await this.sql`select * from student_tasks where id=${id}`;
    return rows[0] ? mapTask(rows[0]) : undefined;
  }
  async listTasksByStudent(studentId: string): Promise<StudentTask[]> {
    return (await this.sql`select * from student_tasks where student_id=${studentId}`).map(mapTask);
  }
  async listTasksByTeacher(teacherId: string): Promise<StudentTask[]> {
    return (await this.sql`select * from student_tasks where teacher_id=${teacherId}`).map(mapTask);
  }

  async insertEvent(e: CalendarEvent): Promise<void> {
    await this.sql`insert into calendar_events (id,school_id,title,type,event_date,year_group,source_id,changed,created_at)
      values (${e.id},${e.schoolId},${e.title},${e.type},${e.eventDate},${e.yearGroup},${e.sourceId},${e.changed},${e.createdAt})`;
  }
  async updateEvent(e: CalendarEvent): Promise<void> {
    await this.sql`update calendar_events set title=${e.title},event_date=${e.eventDate},changed=${e.changed} where id=${e.id}`;
  }
  async getEvent(id: string): Promise<CalendarEvent | undefined> {
    const rows = await this.sql`select * from calendar_events where id=${id}`;
    return rows[0] ? mapEvent(rows[0]) : undefined;
  }
  async listEventsBySchool(schoolId: string): Promise<CalendarEvent[]> {
    return (await this.sql`select * from calendar_events where school_id=${schoolId}`).map(mapEvent);
  }

  async insertHelpSession(s: HelpSession): Promise<void> {
    await this.sql`insert into help_sessions (id,school_id,student_id,task_id,teacher_id,created_at)
      values (${s.id},${s.schoolId},${s.studentId},${s.taskId},${s.teacherId},${s.createdAt})`;
  }
  async getHelpSession(id: string): Promise<HelpSession | undefined> {
    const rows = await this.sql`select * from help_sessions where id=${id}`;
    return rows[0] ? mapSession(rows[0]) : undefined;
  }
  async findHelpSession(studentId: string, taskId: string): Promise<HelpSession | undefined> {
    const rows = await this.sql`select * from help_sessions where student_id=${studentId} and task_id=${taskId} limit 1`;
    return rows[0] ? mapSession(rows[0]) : undefined;
  }
  async insertHelpMessage(m: HelpMessage): Promise<void> {
    await this.sql`insert into help_messages (id,session_id,role,text,kind,created_at)
      values (${m.id},${m.sessionId},${m.role},${m.text},${m.kind},${m.createdAt})`;
  }
  async listHelpMessages(sessionId: string): Promise<HelpMessage[]> {
    return (await this.sql`select * from help_messages where session_id=${sessionId} order by created_at asc`).map(mapMessage);
  }
  async deleteHelpMessagesBefore(iso: string): Promise<number> {
    const rows = await this.sql`delete from help_messages where created_at < ${iso} returning id`;
    return rows.length;
  }
}

type Row = Record<string, any>;
function mapTask(r: Row): StudentTask {
  return {
    id: r.id, schoolId: r.school_id, studentId: r.student_id, classId: r.class_id, teacherId: r.teacher_id,
    type: r.type as TaskType, title: r.title, nodeId: r.node_id, assessmentId: r.assessment_id,
    dueDate: iso(r.due_date), status: r.status as TaskStatus, completedAt: isoOrNull(r.completed_at),
    overdueNotified: r.overdue_notified, createdAt: iso(r.created_at),
  };
}
function mapEvent(r: Row): CalendarEvent {
  return {
    id: r.id, schoolId: r.school_id, title: r.title, type: r.type as CalendarEventType,
    eventDate: iso(r.event_date), yearGroup: r.year_group, sourceId: r.source_id,
    changed: r.changed, createdAt: iso(r.created_at),
  };
}
function mapSession(r: Row): HelpSession {
  return { id: r.id, schoolId: r.school_id, studentId: r.student_id, taskId: r.task_id, teacherId: r.teacher_id, createdAt: iso(r.created_at) };
}
function mapMessage(r: Row): HelpMessage {
  return { id: r.id, sessionId: r.session_id, role: r.role as HelpMessageRole, text: r.text, kind: r.kind as HelpResponseKind, createdAt: iso(r.created_at) };
}
