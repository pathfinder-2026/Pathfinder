import type {
  PeerCorrection,
  PeerPlacement,
  PeerReview,
  PeerTest,
  PeerTestSubmission,
} from "../../domain/peer";
import type { PeerStore } from "../../ports/peerStore";

const clone = <T>(v: T): T => structuredClone(v);

export class InMemoryPeerStore implements PeerStore {
  private tests = new Map<string, PeerTest>();
  private submissions = new Map<string, PeerTestSubmission>();
  private reviews = new Map<string, PeerReview>();
  private corrections = new Map<string, PeerCorrection>();
  private placements = new Map<string, PeerPlacement>();

  async insertPeerTest(t: PeerTest): Promise<void> { this.tests.set(t.id, clone(t)); }
  async getPeerTest(id: string): Promise<PeerTest | undefined> { const v = this.tests.get(id); return v ? clone(v) : undefined; }
  async updatePeerTest(t: PeerTest): Promise<void> { this.tests.set(t.id, clone(t)); }
  async listPeerTestsBySchool(schoolId: string): Promise<PeerTest[]> {
    return [...this.tests.values()].filter((t) => t.schoolId === schoolId).map(clone);
  }

  async insertSubmission(s: PeerTestSubmission): Promise<void> { this.submissions.set(s.id, clone(s)); }
  async listSubmissions(peerTestId: string): Promise<PeerTestSubmission[]> {
    return [...this.submissions.values()].filter((s) => s.peerTestId === peerTestId).map(clone);
  }

  async insertReview(r: PeerReview): Promise<void> { this.reviews.set(r.id, clone(r)); }
  async getReview(id: string): Promise<PeerReview | undefined> { const v = this.reviews.get(id); return v ? clone(v) : undefined; }
  async updateReview(r: PeerReview): Promise<void> { this.reviews.set(r.id, clone(r)); }
  async listReviewsByTest(peerTestId: string): Promise<PeerReview[]> {
    return [...this.reviews.values()].filter((r) => r.peerTestId === peerTestId).map(clone);
  }
  async listReviewsByTarget(targetStudentId: string): Promise<PeerReview[]> {
    return [...this.reviews.values()].filter((r) => r.targetStudentId === targetStudentId).map(clone);
  }

  async insertCorrection(c: PeerCorrection): Promise<void> { this.corrections.set(c.id, clone(c)); }
  async listCorrections(peerTestId: string): Promise<PeerCorrection[]> {
    return [...this.corrections.values()].filter((c) => c.peerTestId === peerTestId).map(clone);
  }

  async insertPlacement(p: PeerPlacement): Promise<void> { this.placements.set(p.id, clone(p)); }
  async listPlacementsByStudent(studentId: string): Promise<PeerPlacement[]> {
    return [...this.placements.values()].filter((p) => p.studentId === studentId).map(clone);
  }
  async listPlacementsByTest(peerTestId: string): Promise<PeerPlacement[]> {
    return [...this.placements.values()].filter((p) => p.peerTestId === peerTestId).map(clone);
  }
  async deletePlacementsByTest(peerTestId: string): Promise<void> {
    for (const [id, p] of this.placements) if (p.peerTestId === peerTestId) this.placements.delete(id);
  }
}
