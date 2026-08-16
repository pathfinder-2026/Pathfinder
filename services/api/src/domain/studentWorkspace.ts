/**
 * Milestone 7 — Student Workspace domain (FR-STU-001/003/004).
 *
 * A deliberately LOW-ANALYTICS student view: today's/this week's tasks, progress,
 * assessments and a calendar. Overdue is marked plainly, without shaming language.
 * Restricted calendar events (wrong year group) are invisible, not greyed out.
 */

export type TaskType = "homework" | "practice" | "assessment";
export type TaskStatus = "assigned" | "completed";

export interface StudentTask {
  id: string;
  schoolId: string;
  studentId: string;
  classId: string | null;
  teacherId: string;
  type: TaskType;
  title: string;
  /** Skill-graph node the task grounds on (for Ask for Help scoping). */
  nodeId: string | null;
  /** Set when the task is (or mirrors) an assessment. */
  assessmentId: string | null;
  /**
   * Approved content attached as the task's readable material — the answer to
   * "where is the worksheet?". Approved-pool only (Decision 7), re-checked at
   * read time so an item unapproved later degrades honestly.
   */
  contentId: string | null;
  dueDate: string;
  status: TaskStatus;
  completedAt: string | null;
  /**
   * A baseline diagnostic assigned when starting a new concept: its graded
   * results become the first mastery data points, so the growth report gets a
   * real starting line and the heatmap escapes its cold start. Framed to the
   * student as planning help, never a graded test.
   */
  baseline?: boolean;
  /** Dedupe: the assigning teacher is notified once when a task becomes overdue. */
  overdueNotified: boolean;
  createdAt: string;
}

export type CalendarEventType = "assessment" | "class" | "homework" | "co_curricular" | "parent_meeting";

export interface CalendarEvent {
  id: string;
  schoolId: string;
  title: string;
  type: CalendarEventType;
  eventDate: string;
  /** null = visible to every year group; otherwise restricted to this one. */
  yearGroup: string | null;
  sourceId: string | null;
  /** True after a reschedule, so the student's view can flag "this changed". */
  changed: boolean;
  createdAt: string;
}

// ---- view models ----

export interface WorkspaceTaskView {
  id: string;
  type: TaskType;
  title: string;
  dueDate: string;
  status: TaskStatus;
  completed: boolean;
  overdue: boolean;
  /** Baseline checks render with calm "helps your teacher plan" framing. */
  baseline: boolean;
}

export interface WorkspaceView {
  /** False → the friendly "nothing assigned yet" state (never a broken screen). */
  hasTasks: boolean;
  today: WorkspaceTaskView[];
  thisWeek: WorkspaceTaskView[];
  emptyMessage: string | null;
}

export interface CalendarItemView {
  id: string;
  title: string;
  type: CalendarEventType | "task";
  date: string;
  changed: boolean;
}

/** Days from `fromIso` to `toIso` (fractional). */
export function daysBetween(fromIso: string, toIso: string): number {
  return (new Date(toIso).getTime() - new Date(fromIso).getTime()) / (24 * 60 * 60 * 1000);
}

export function isOverdue(task: StudentTask, nowIso: string): boolean {
  return task.status !== "completed" && new Date(task.dueDate).getTime() < new Date(nowIso).getTime();
}
