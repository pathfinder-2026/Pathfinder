import type {
  Accommodation,
  AnonymityLevel,
  BenchmarkPublishState,
  PeerCorrection,
  PeerPlacement,
  PeerReview,
  PeerTest,
  PeerTestStatus,
  PeerTestSubmission,
  ReviewModerationState,
} from "../../domain/peer";
import type { PeerStore } from "../../ports/peerStore";
import { iso, isoOrNull, type Sql } from "./pgClient";

/** PostgreSQL PeerStore adapter (ap-southeast-2). */
export class PgPeerStore implements PeerStore {
  constructor(private readonly sql: Sql) {}

  async insertPeerTest(t: PeerTest): Promise<void> {
    await this.sql`insert into peer_tests
      (id,school_id,teacher_id,title,node_id,question_count,rubric,cohort,anonymity,accommodations,
       status,benchmark_publish,scheduled_start,launched_at,closed_at,cancelled_at,warnings,created_at)
      values (${t.id},${t.schoolId},${t.teacherId},${t.title},${t.nodeId},${t.questionCount},${t.rubric},
        ${this.sql.json(t.cohort)},${t.anonymity},${this.sql.json(t.accommodations as never)},${t.status},${t.benchmarkPublish},
        ${t.scheduledStart},${t.launchedAt},${t.closedAt},${t.cancelledAt},${this.sql.json(t.warnings)},${t.createdAt})`;
  }
  async updatePeerTest(t: PeerTest): Promise<void> {
    await this.sql`update peer_tests set title=${t.title},node_id=${t.nodeId},question_count=${t.questionCount},
      rubric=${t.rubric},cohort=${this.sql.json(t.cohort)},anonymity=${t.anonymity},
      accommodations=${this.sql.json(t.accommodations as never)},status=${t.status},benchmark_publish=${t.benchmarkPublish},
      scheduled_start=${t.scheduledStart},launched_at=${t.launchedAt},closed_at=${t.closedAt},
      cancelled_at=${t.cancelledAt},warnings=${this.sql.json(t.warnings)} where id=${t.id}`;
  }
  async getPeerTest(id: string): Promise<PeerTest | undefined> {
    const rows = await this.sql`select * from peer_tests where id=${id}`;
    return rows[0] ? mapTest(rows[0]) : undefined;
  }
  async listPeerTestsBySchool(schoolId: string): Promise<PeerTest[]> {
    return (await this.sql`select * from peer_tests where school_id=${schoolId}`).map(mapTest);
  }

  async insertSubmission(s: PeerTestSubmission): Promise<void> {
    await this.sql`insert into peer_test_submissions (id,peer_test_id,student_id,score,submitted_at)
      values (${s.id},${s.peerTestId},${s.studentId},${s.score},${s.submittedAt})`;
  }
  async listSubmissions(peerTestId: string): Promise<PeerTestSubmission[]> {
    return (await this.sql`select * from peer_test_submissions where peer_test_id=${peerTestId}`).map(mapSub);
  }

  async insertReview(r: PeerReview): Promise<void> {
    await this.sql`insert into peer_reviews
      (id,school_id,peer_test_id,reviewer_id,target_student_id,text,moderation_state,moderated_by,moderated_at,created_at)
      values (${r.id},${r.schoolId},${r.peerTestId},${r.reviewerId},${r.targetStudentId},${r.text},
        ${r.moderationState},${r.moderatedBy},${r.moderatedAt},${r.createdAt})`;
  }
  async updateReview(r: PeerReview): Promise<void> {
    await this.sql`update peer_reviews set moderation_state=${r.moderationState},moderated_by=${r.moderatedBy},
      moderated_at=${r.moderatedAt} where id=${r.id}`;
  }
  async getReview(id: string): Promise<PeerReview | undefined> {
    const rows = await this.sql`select * from peer_reviews where id=${id}`;
    return rows[0] ? mapReview(rows[0]) : undefined;
  }
  async listReviewsByTest(peerTestId: string): Promise<PeerReview[]> {
    return (await this.sql`select * from peer_reviews where peer_test_id=${peerTestId}`).map(mapReview);
  }
  async listReviewsByTarget(targetStudentId: string): Promise<PeerReview[]> {
    return (await this.sql`select * from peer_reviews where target_student_id=${targetStudentId}`).map(mapReview);
  }

  async insertCorrection(c: PeerCorrection): Promise<void> {
    await this.sql`insert into peer_corrections
      (id,peer_test_id,student_id,previous_score,corrected_score,reason,corrected_by,at)
      values (${c.id},${c.peerTestId},${c.studentId},${c.previousScore},${c.correctedScore},${c.reason},${c.correctedBy},${c.at})`;
  }
  async listCorrections(peerTestId: string): Promise<PeerCorrection[]> {
    return (await this.sql`select * from peer_corrections where peer_test_id=${peerTestId}`).map(mapCorrection);
  }

  async insertPlacement(p: PeerPlacement): Promise<void> {
    await this.sql`insert into peer_placements (id,peer_test_id,student_id,placed_at)
      values (${p.id},${p.peerTestId},${p.studentId},${p.placedAt})`;
  }
  async listPlacementsByStudent(studentId: string): Promise<PeerPlacement[]> {
    return (await this.sql`select * from peer_placements where student_id=${studentId}`).map(mapPlacement);
  }
  async listPlacementsByTest(peerTestId: string): Promise<PeerPlacement[]> {
    return (await this.sql`select * from peer_placements where peer_test_id=${peerTestId}`).map(mapPlacement);
  }
  async deletePlacementsByTest(peerTestId: string): Promise<void> {
    await this.sql`delete from peer_placements where peer_test_id=${peerTestId}`;
  }
}

type Row = Record<string, any>;
function mapTest(r: Row): PeerTest {
  return {
    id: r.id, schoolId: r.school_id, teacherId: r.teacher_id, title: r.title, nodeId: r.node_id,
    questionCount: Number(r.question_count), rubric: r.rubric, cohort: r.cohort as string[],
    anonymity: r.anonymity as AnonymityLevel, accommodations: r.accommodations as Accommodation[],
    status: r.status as PeerTestStatus, benchmarkPublish: r.benchmark_publish as BenchmarkPublishState,
    scheduledStart: isoOrNull(r.scheduled_start), launchedAt: isoOrNull(r.launched_at),
    closedAt: isoOrNull(r.closed_at), cancelledAt: isoOrNull(r.cancelled_at),
    warnings: r.warnings as string[], createdAt: iso(r.created_at),
  };
}
function mapSub(r: Row): PeerTestSubmission {
  return { id: r.id, peerTestId: r.peer_test_id, studentId: r.student_id, score: Number(r.score), submittedAt: iso(r.submitted_at) };
}
function mapReview(r: Row): PeerReview {
  return {
    id: r.id, schoolId: r.school_id, peerTestId: r.peer_test_id, reviewerId: r.reviewer_id,
    targetStudentId: r.target_student_id, text: r.text, moderationState: r.moderation_state as ReviewModerationState,
    moderatedBy: r.moderated_by, moderatedAt: isoOrNull(r.moderated_at), createdAt: iso(r.created_at),
  };
}
function mapCorrection(r: Row): PeerCorrection {
  return {
    id: r.id, peerTestId: r.peer_test_id, studentId: r.student_id, previousScore: Number(r.previous_score),
    correctedScore: Number(r.corrected_score), reason: r.reason, correctedBy: r.corrected_by, at: iso(r.at),
  };
}
function mapPlacement(r: Row): PeerPlacement {
  return { id: r.id, peerTestId: r.peer_test_id, studentId: r.student_id, placedAt: iso(r.placed_at) };
}
