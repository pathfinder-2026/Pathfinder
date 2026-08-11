import type {
  PeerCorrection,
  PeerPlacement,
  PeerReview,
  PeerTest,
  PeerTestSubmission,
} from "../domain/peer";

/**
 * Persistence port for the Milestone 5b peer layer. Two adapter families satisfy
 * it — in-memory (dev/tests) and PostgreSQL. Computed benchmarks are NOT stored
 * (they are derived from submissions + corrections on read), which is part of how
 * the "results cannot be edited" guarantee is enforced structurally.
 */
export interface PeerStore {
  insertPeerTest(t: PeerTest): Promise<void>;
  getPeerTest(id: string): Promise<PeerTest | undefined>;
  updatePeerTest(t: PeerTest): Promise<void>;
  listPeerTestsBySchool(schoolId: string): Promise<PeerTest[]>;

  insertSubmission(s: PeerTestSubmission): Promise<void>;
  listSubmissions(peerTestId: string): Promise<PeerTestSubmission[]>;

  insertReview(r: PeerReview): Promise<void>;
  getReview(id: string): Promise<PeerReview | undefined>;
  updateReview(r: PeerReview): Promise<void>;
  listReviewsByTest(peerTestId: string): Promise<PeerReview[]>;
  listReviewsByTarget(targetStudentId: string): Promise<PeerReview[]>;

  insertCorrection(c: PeerCorrection): Promise<void>;
  listCorrections(peerTestId: string): Promise<PeerCorrection[]>;

  insertPlacement(p: PeerPlacement): Promise<void>;
  listPlacementsByStudent(studentId: string): Promise<PeerPlacement[]>;
  listPlacementsByTest(peerTestId: string): Promise<PeerPlacement[]>;
  deletePlacementsByTest(peerTestId: string): Promise<void>;
}
