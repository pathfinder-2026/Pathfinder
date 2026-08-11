import { ConflictError, NotFoundError } from "../domain/errors";
import { anonymityRisk, PEER_THRESHOLDS, type PeerReview } from "../domain/peer";
import type { AuditRecorder } from "../platform/audit/auditLog";
import type { Clock } from "../platform/clock";
import { newId } from "../platform/ids";
import type { DataStore } from "../ports/dataStore";
import type { PeerStore } from "../ports/peerStore";

export interface StudentPeerFeedback {
  hasFeedback: boolean;
  /** Approved reviews only, anonymised — reviewer identity is never included. */
  reviews: { text: string }[];
  message: string;
}

/**
 * Milestone 5b — FR-PEER-002: anonymised peer review with teacher moderation
 * BEFORE release. Peer feedback is genuinely peer-authored: a teacher may reject
 * or hide a review, but there is deliberately no way to rewrite its wording.
 * Nothing reaches the reviewed student until the teacher approves it.
 */
export class PeerReviewService {
  private readonly t = PEER_THRESHOLDS;

  constructor(
    private readonly peers: PeerStore,
    private readonly store: DataStore,
    private readonly clock: Clock,
    private readonly audit: AuditRecorder,
  ) {}

  /**
   * A student submits an anonymised peer review. If the cohort is small enough
   * that writing style could de-anonymise the reviewer, the risk is flagged to
   * the Teacher rather than promising anonymity the system cannot guarantee.
   */
  async submitReview(
    reviewerId: string, schoolId: string, peerTestId: string, targetStudentId: string, text: string,
  ): Promise<{ review: PeerReview; anonymityRisk: boolean }> {
    const test = await this.peers.getPeerTest(peerTestId);
    if (!test) throw new NotFoundError("Peer test not found.");
    const review: PeerReview = {
      id: newId(), schoolId, peerTestId, reviewerId, targetStudentId, text,
      moderationState: "pending", moderatedBy: null, moderatedAt: null, createdAt: this.clock.isoNow(),
    };
    await this.peers.insertReview(review);
    const risk = anonymityRisk(test.cohort.length, this.t);
    this.audit.append({
      action: "peer.review.submitted", actorId: reviewerId, subjectType: "peer_review", subjectId: review.id,
      metadata: { peerTestId, anonymityRisk: risk },
    });
    return { review, anonymityRisk: risk };
  }

  /**
   * The Teacher moderates a review: approve or reject. There is NO text parameter
   * — a teacher can hide/reject an inappropriate review but never rewrite it, so
   * peer feedback stays genuinely peer-authored.
   */
  async moderate(teacherId: string, reviewId: string, decision: "approve" | "reject"): Promise<PeerReview> {
    await this.requireTeacher(teacherId);
    const review = await this.peers.getReview(reviewId);
    if (!review) throw new NotFoundError("Review not found.");
    review.moderationState = decision === "approve" ? "approved" : "rejected";
    review.moderatedBy = teacherId;
    review.moderatedAt = this.clock.isoNow();
    await this.peers.updateReview(review);
    this.audit.append({
      action: "peer.review.moderated", actorId: teacherId, subjectType: "peer_review", subjectId: review.id,
      metadata: { decision: review.moderationState },
    });
    return review;
  }

  /** Reviews flagged as an anonymity risk for the Teacher to consider. */
  async pendingForTest(peerTestId: string): Promise<PeerReview[]> {
    return (await this.peers.listReviewsByTest(peerTestId)).filter((r) => r.moderationState === "pending");
  }

  /**
   * What a reviewed student sees: only APPROVED reviews, anonymised. A round that
   * closed with nothing approved shows a neutral "no peer feedback" state rather
   * than an empty/broken screen.
   */
  async feedbackForStudent(studentId: string): Promise<StudentPeerFeedback> {
    const approved = (await this.peers.listReviewsByTarget(studentId)).filter((r) => r.moderationState === "approved");
    if (approved.length === 0) {
      return { hasFeedback: false, reviews: [], message: "No peer feedback this round." };
    }
    return { hasFeedback: true, reviews: approved.map((r) => ({ text: r.text })), message: "" };
  }

  private async requireTeacher(actorId: string): Promise<void> {
    const memberships = await this.store.listMembershipsByUser(actorId);
    if (!memberships.some((m) => m.role === "teacher")) {
      throw new ConflictError("NOT_A_TEACHER", "Only a Teacher may moderate peer reviews.");
    }
  }
}
