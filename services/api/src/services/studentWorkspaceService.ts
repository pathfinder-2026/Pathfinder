import { ConflictError, NotFoundError, ValidationError } from "../domain/errors";
import {
  daysBetween,
  isOverdue,
  type CalendarEvent,
  type CalendarEventType,
  type CalendarItemView,
  type StudentTask,
  type TaskType,
  type WorkspaceTaskView,
  type WorkspaceView,
} from "../domain/studentWorkspace";
import type { AuditRecorder } from "../platform/audit/auditLog";
import type { Clock } from "../platform/clock";
import type { NotificationService } from "../platform/notifications/notificationService";
import { newId } from "../platform/ids";
import type { DataStore } from "../ports/dataStore";
import type { WorkspaceStore } from "../ports/workspaceStore";

export interface AssignTaskInput {
  studentId: string;
  classId?: string | null;
  type: TaskType;
  title: string;
  nodeId?: string | null;
  assessmentId?: string | null;
  /** Approved content to attach as the task's readable material. */
  contentId?: string | null;
  dueDate: string;
  baseline?: boolean;
}

export interface CreateEventInput {
  title: string;
  type: CalendarEventType;
  eventDate: string;
  yearGroup?: string | null;
  sourceId?: string | null;
}

/**
 * Milestone 7 — FR-STU-001/003/004. The low-analytics student workspace and
 * calendar. Overdue tasks are marked plainly (no shaming language) and notify the
 * assigning teacher once; restricted calendar events (wrong year group) are
 * invisible, and a rescheduled event is flagged as changed.
 */
export class StudentWorkspaceService {
  constructor(
    private readonly workspace: WorkspaceStore,
    private readonly store: DataStore,
    private readonly clock: Clock,
    private readonly audit: AuditRecorder,
    private readonly notifications: NotificationService,
  ) {}

  // ---- teacher-side setup ----

  async assignTask(teacherId: string, schoolId: string, input: AssignTaskInput): Promise<StudentTask> {
    await this.requireTeacher(teacherId, schoolId);
    const task: StudentTask = {
      id: newId(), schoolId, studentId: input.studentId, classId: input.classId ?? null, teacherId,
      type: input.type, title: input.title, nodeId: input.nodeId ?? null, assessmentId: input.assessmentId ?? null,
      contentId: input.contentId ?? null,
      dueDate: input.dueDate, status: "assigned", completedAt: null, overdueNotified: false,
      baseline: input.baseline ?? false,
      createdAt: this.clock.isoNow(),
    };
    await this.workspace.insertTask(task);
    return task;
  }

  /**
   * Assign one piece of work to MANY students in one explicit teacher action —
   * the workflow behind "assign to the class / this group / everyone below
   * mastery". Selection happens in the UI (suggest-then-confirm, never
   * auto-assigned); this only fans the confirmed list out and audits it once.
   */
  async assignToStudents(
    teacherId: string,
    schoolId: string,
    input: Omit<AssignTaskInput, "studentId"> & { studentIds: string[] },
  ): Promise<StudentTask[]> {
    await this.requireTeacher(teacherId, schoolId);
    if (input.studentIds.length === 0) {
      throw new ValidationError("At least one student is required — nothing was assigned.");
    }
    const tasks: StudentTask[] = [];
    for (const studentId of new Set(input.studentIds)) {
      tasks.push(await this.assignTask(teacherId, schoolId, { ...input, studentId }));
    }
    this.audit.append({
      action: "task.assigned.bulk",
      actorId: teacherId,
      subjectType: "class",
      subjectId: input.classId ?? schoolId,
      metadata: {
        students: tasks.length, type: input.type, assessmentId: input.assessmentId ?? null,
        nodeId: input.nodeId ?? null, baseline: input.baseline ?? false,
      },
    });
    return tasks;
  }

  async completeTask(studentId: string, taskId: string): Promise<StudentTask> {
    const task = await this.workspace.getTask(taskId);
    if (!task || task.studentId !== studentId) throw new NotFoundError("Task not found.");
    task.status = "completed";
    task.completedAt = this.clock.isoNow();
    await this.workspace.updateTask(task);
    return task;
  }

  async createEvent(teacherId: string, schoolId: string, input: CreateEventInput): Promise<CalendarEvent> {
    await this.requireTeacher(teacherId, schoolId);
    const event: CalendarEvent = {
      id: newId(), schoolId, title: input.title, type: input.type, eventDate: input.eventDate,
      yearGroup: input.yearGroup ?? null, sourceId: input.sourceId ?? null, changed: false,
      createdAt: this.clock.isoNow(),
    };
    await this.workspace.insertEvent(event);
    return event;
  }

  /** FR-STU-004 edge — reschedule flags the event as changed so the student sees it moved. */
  async rescheduleEvent(teacherId: string, schoolId: string, eventId: string, newDate: string): Promise<CalendarEvent> {
    await this.requireTeacher(teacherId, schoolId);
    const event = await this.workspace.getEvent(eventId);
    if (!event) throw new NotFoundError("Event not found.");
    event.eventDate = newDate;
    event.changed = true;
    await this.workspace.updateEvent(event);
    this.audit.append({ action: "calendar.event.rescheduled", actorId: teacherId, subjectType: "calendar_event", subjectId: eventId, metadata: { newDate } });
    return event;
  }

  // ---- student-side views ----

  /** FR-STU-001/003 — the student's today/this-week view. */
  async workspaceFor(studentId: string): Promise<WorkspaceView> {
    const nowIso = this.clock.isoNow();
    const tasks = await this.workspace.listTasksByStudent(studentId);
    if (tasks.length === 0) {
      return { hasTasks: false, today: [], thisWeek: [], emptyMessage: "Nothing assigned yet — you’re all caught up." };
    }

    // Notify the assigning teacher once for each newly-overdue task.
    for (const task of tasks) {
      if (isOverdue(task, nowIso) && !task.overdueNotified) {
        await this.notifications.send({
          type: "alert.overdue", to: task.teacherId, subject: "A student has an overdue task",
          body: `Task "${task.title}" is overdue.`, context: { taskId: task.id, studentId },
        });
        task.overdueNotified = true;
        await this.workspace.updateTask(task);
      }
    }

    const view = (t: StudentTask): WorkspaceTaskView => ({
      id: t.id, type: t.type, title: t.title, dueDate: t.dueDate, status: t.status,
      completed: t.status === "completed", overdue: isOverdue(t, nowIso),
      baseline: t.baseline ?? false,
    });
    const today = tasks.filter((t) => sameDay(t.dueDate, nowIso)).map(view);
    const thisWeek = tasks.filter((t) => withinDays(t.dueDate, nowIso, 7)).map(view);
    return { hasTasks: true, today, thisWeek, emptyMessage: null };
  }

  /** FR-STU-004 — the student's calendar: permitted events + their own task due dates. */
  async calendarFor(studentId: string): Promise<CalendarItemView[]> {
    const yearGroup = await this.studentYearGroup(studentId);
    const schoolId = await this.studentSchool(studentId);
    const items: CalendarItemView[] = [];

    if (schoolId) {
      for (const e of await this.workspace.listEventsBySchool(schoolId)) {
        // Restricted event for a different year group → invisible (not greyed out).
        if (e.yearGroup !== null && e.yearGroup !== yearGroup) continue;
        items.push({ id: e.id, title: e.title, type: e.type, date: e.eventDate, changed: e.changed });
      }
    }
    for (const t of await this.workspace.listTasksByStudent(studentId)) {
      items.push({ id: t.id, title: t.title, type: "task", date: t.dueDate, changed: false });
    }
    return items.sort((a, b) => a.date.localeCompare(b.date));
  }

  // ---- helpers ----

  private async studentYearGroup(studentId: string): Promise<string | null> {
    const membership = (await this.store.listMembershipsByUser(studentId)).find((m) => m.role === "student" && m.classId);
    if (!membership?.classId) return null;
    return (await this.store.getClass(membership.classId))?.yearGroup ?? null;
  }
  private async studentSchool(studentId: string): Promise<string | null> {
    return (await this.store.listMembershipsByUser(studentId)).find((m) => m.role === "student")?.schoolId ?? null;
  }
  private async requireTeacher(actorId: string, schoolId: string): Promise<void> {
    const memberships = await this.store.listMembershipsByUser(actorId);
    if (!memberships.some((m) => m.schoolId === schoolId && m.role === "teacher")) {
      throw new ConflictError("NOT_A_TEACHER", "Only a Teacher may assign tasks or manage events.");
    }
  }
}

function sameDay(aIso: string, bIso: string): boolean {
  return aIso.slice(0, 10) === bIso.slice(0, 10);
}
function withinDays(dueIso: string, nowIso: string, days: number): boolean {
  const d = daysBetween(nowIso, dueIso);
  return d >= -3650 && d <= days; // include already-due tasks and the coming week
}
