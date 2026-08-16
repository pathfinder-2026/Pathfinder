import type {
  Assessment,
  AssessmentAttempt,
  AssessmentQuestion,
  AssessmentVersion,
} from "../../domain/assessment";
import type { AssessmentStore } from "../../ports/assessmentStore";
import { iso, isoOrNull, type Sql } from "./pgClient";

/** PostgreSQL AssessmentStore adapter (ap-southeast-2). */
export class PgAssessmentStore implements AssessmentStore {
  constructor(private readonly sql: Sql) {}

  async insertAssessment(a: Assessment): Promise<void> {
    await this.sql`insert into assessments
      (id,school_id,teacher_id,title,request,status,generation_status,published_at,scheduled_start,review_acknowledged,shortfall,flags,created_at)
      values (${a.id},${a.schoolId},${a.teacherId},${a.title},${this.sql.json(a.request as never)},${a.status},
        ${a.generationStatus},${a.publishedAt},${a.scheduledStart},${a.reviewAcknowledged},
        ${a.shortfall ? this.sql.json(a.shortfall as never) : null},${this.sql.json(a.flags)},${a.createdAt})`;
  }
  async getAssessment(id: string): Promise<Assessment | undefined> {
    return mapAssessment((await this.sql`select * from assessments where id=${id}`)[0]);
  }
  async updateAssessment(a: Assessment): Promise<void> {
    await this.sql`update assessments set status=${a.status}, generation_status=${a.generationStatus},
      published_at=${a.publishedAt}, scheduled_start=${a.scheduledStart}, review_acknowledged=${a.reviewAcknowledged},
      shortfall=${a.shortfall ? this.sql.json(a.shortfall as never) : null}, flags=${this.sql.json(a.flags)} where id=${a.id}`;
  }
  async listAssessmentsByTeacher(teacherId: string): Promise<Assessment[]> {
    return (await this.sql`select * from assessments where teacher_id=${teacherId}`).map(mapAssessment) as Assessment[];
  }

  async insertVersion(v: AssessmentVersion): Promise<void> {
    await this.sql`insert into assessment_versions (id,assessment_id,label,created_at)
      values (${v.id},${v.assessmentId},${v.label},${v.createdAt})`;
  }
  async listVersionsByAssessment(assessmentId: string): Promise<AssessmentVersion[]> {
    return (await this.sql`select * from assessment_versions where assessment_id=${assessmentId} order by label`).map(
      (r) => ({ id: r.id, assessmentId: r.assessment_id, label: r.label, createdAt: iso(r.created_at) }),
    );
  }

  async insertQuestion(q: AssessmentQuestion): Promise<void> {
    await this.sql`insert into assessment_questions
      (id,version_id,"order",type,prompt,options,model_answer,rubric,difficulty,grounding_content_ids,reviewed,teacher_edited,teacher_authored)
      values (${q.id},${q.versionId},${q.order},${q.type},${q.prompt},${q.options ? this.sql.json(q.options) : null},
        ${q.modelAnswer},${q.rubric},${q.difficulty},${this.sql.json(q.groundingContentIds)},${q.reviewed},
        ${q.teacherEdited ?? false},${q.teacherAuthored ?? false})`;
  }
  async getQuestion(id: string): Promise<AssessmentQuestion | undefined> {
    return mapQuestion((await this.sql`select * from assessment_questions where id=${id}`)[0]);
  }
  async updateQuestion(q: AssessmentQuestion): Promise<void> {
    await this.sql`update assessment_questions set prompt=${q.prompt},
      options=${q.options ? this.sql.json(q.options) : null}, model_answer=${q.modelAnswer}, rubric=${q.rubric},
      difficulty=${q.difficulty}, grounding_content_ids=${this.sql.json(q.groundingContentIds)}, reviewed=${q.reviewed},
      teacher_edited=${q.teacherEdited ?? false}, teacher_authored=${q.teacherAuthored ?? false}
      where id=${q.id}`;
  }
  async deleteQuestion(id: string): Promise<void> {
    await this.sql`delete from assessment_questions where id=${id}`;
  }
  async listQuestionsByVersion(versionId: string): Promise<AssessmentQuestion[]> {
    return (await this.sql`select * from assessment_questions where version_id=${versionId} order by "order"`).map(mapQuestion) as AssessmentQuestion[];
  }
  async listQuestionsByAssessment(assessmentId: string): Promise<AssessmentQuestion[]> {
    return (await this.sql`select q.* from assessment_questions q
      join assessment_versions v on v.id = q.version_id where v.assessment_id=${assessmentId}`).map(mapQuestion) as AssessmentQuestion[];
  }

  async insertAttempt(a: AssessmentAttempt): Promise<void> {
    await this.sql`insert into assessment_attempts
      (id,assessment_id,student_id,status,saved_answers,last_saved_at,interrupted,resume_deadline,created_at,
       graded_score,graded_results,graded_at)
      values (${a.id},${a.assessmentId},${a.studentId},${a.status},${this.sql.json(a.savedAnswers)},
        ${a.lastSavedAt},${a.interrupted},${a.resumeDeadline},${a.createdAt},
        ${a.gradedScore ?? null},${a.gradedResults ? this.sql.json(a.gradedResults as never) : null},${a.gradedAt ?? null})`;
  }
  async getAttempt(id: string): Promise<AssessmentAttempt | undefined> {
    return mapAttempt((await this.sql`select * from assessment_attempts where id=${id}`)[0]);
  }
  async updateAttempt(a: AssessmentAttempt): Promise<void> {
    await this.sql`update assessment_attempts set status=${a.status}, saved_answers=${this.sql.json(a.savedAnswers)},
      last_saved_at=${a.lastSavedAt}, interrupted=${a.interrupted}, resume_deadline=${a.resumeDeadline},
      graded_score=${a.gradedScore ?? null}, graded_results=${a.gradedResults ? this.sql.json(a.gradedResults as never) : null},
      graded_at=${a.gradedAt ?? null} where id=${a.id}`;
  }
  async listAttemptsByAssessment(assessmentId: string): Promise<AssessmentAttempt[]> {
    return (await this.sql`select * from assessment_attempts where assessment_id=${assessmentId}`).map(mapAttempt) as AssessmentAttempt[];
  }
  async listAttemptsByStudent(studentId: string): Promise<AssessmentAttempt[]> {
    return (await this.sql`select * from assessment_attempts where student_id=${studentId}`).map(mapAttempt) as AssessmentAttempt[];
  }
}

type Row = Record<string, any> | undefined;

function mapAssessment(r: Row): Assessment | undefined {
  return r && {
    id: r.id,
    schoolId: r.school_id,
    teacherId: r.teacher_id,
    title: r.title,
    request: r.request,
    status: r.status,
    generationStatus: r.generation_status,
    publishedAt: isoOrNull(r.published_at),
    scheduledStart: isoOrNull(r.scheduled_start),
    reviewAcknowledged: r.review_acknowledged,
    shortfall: r.shortfall ?? null,
    flags: r.flags,
    createdAt: iso(r.created_at),
  };
}
function mapQuestion(r: Row): AssessmentQuestion | undefined {
  return r && {
    id: r.id,
    versionId: r.version_id,
    order: Number(r.order),
    type: r.type,
    prompt: r.prompt,
    options: r.options ?? null,
    modelAnswer: r.model_answer,
    rubric: r.rubric,
    difficulty: r.difficulty,
    groundingContentIds: r.grounding_content_ids,
    reviewed: r.reviewed,
    teacherEdited: r.teacher_edited ?? false,
    teacherAuthored: r.teacher_authored ?? false,
  };
}
function mapAttempt(r: Row): AssessmentAttempt | undefined {
  return r && {
    id: r.id,
    assessmentId: r.assessment_id,
    studentId: r.student_id,
    status: r.status,
    savedAnswers: r.saved_answers,
    lastSavedAt: iso(r.last_saved_at),
    interrupted: r.interrupted,
    resumeDeadline: iso(r.resume_deadline),
    createdAt: iso(r.created_at),
    gradedScore: r.graded_score === null || r.graded_score === undefined ? null : Number(r.graded_score),
    gradedResults: r.graded_results ?? null,
    gradedAt: isoOrNull(r.graded_at),
  };
}
