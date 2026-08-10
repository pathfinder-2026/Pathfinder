import type { Governed } from "../platform/governance/governanceState";

/**
 * Milestone 1 — Content Studio + Knowledge Engine domain.
 *
 * The teacher-approval gate is load-bearing from here: a ContentItem only enters
 * the approved pool (queryable by downstream features) once it is scan-clean,
 * rights-attested, successfully ingested, has an approved classification, is not
 * archived, and its governance state is approved. See ContentService.approvedPool.
 */

export type ContentFileType =
  | "pdf" | "doc" | "docx" | "ppt" | "pptx" | "txt" | "md" | "csv"
  | "mp4" | "mov" | "webm" | "mp3" | "wav" | "png" | "jpg" | "jpeg" | "link";

export type ScanStatus = "pending" | "clean" | "quarantined";

export type IngestionStatus =
  | "pending"
  | "processing"
  | "ingested"
  | "needs_ocr"
  | "failed";

/** Terminal ingestion states — ingestion must always reach one (NFR-PERF-001). */
export const TERMINAL_INGESTION: ReadonlySet<IngestionStatus> = new Set([
  "ingested",
  "needs_ocr",
  "failed",
]);

export type ClassificationStatus = "suggested" | "approved";

export type ShareScope =
  | { type: "private" }
  | { type: "class"; classId: string }
  | { type: "department"; department: string };

export interface ContentItem {
  id: string;
  schoolId: string;
  ownerTeacherId: string;
  title: string;
  currentVersionId: string;
  governance: Governed;
  /** Third-party-copyright attestation (FR-CONT-001 NEW v1.4). */
  rightsAttested: boolean;
  archived: boolean;
  share: ShareScope;
  createdAt: string;
}

export interface ContentVersion {
  id: string;
  contentItemId: string;
  versionNumber: number;
  fileType: ContentFileType;
  sizeBytes: number;
  contentHash: string;
  /** Key of the stored source object (StoragePort / S3). */
  storageKey: string;
  uploadedByTeacherId: string;
  scanStatus: ScanStatus;
  ingestionStatus: IngestionStatus;
  createdAt: string;
}

export interface Classification {
  id: string;
  contentItemId: string;
  subject: string;
  year: number;
  topic: string;
  outcome: string;
  difficulty: string;
  confidence: number;
  lowConfidence: boolean;
  status: ClassificationStatus;
  reviewedByTeacherId: string | null;
}

export interface Chunk {
  id: string;
  contentVersionId: string;
  heading: string;
  text: string;
  order: number;
}

export interface Concept {
  id: string;
  contentVersionId: string;
  name: string;
}

export interface Outcome {
  id: string;
  schoolId: string;
  code: string;
  description: string;
  deprecated: boolean;
}

export interface Question {
  id: string;
  schoolId: string;
  text: string;
  outcomeIds: string[];
}

export interface Lesson {
  id: string;
  schoolId: string;
  title: string;
  questionIds: string[];
  outcomeIds: string[];
}

/** A reference to a content item from elsewhere (e.g. an active assignment). */
export interface ContentReference {
  id: string;
  contentItemId: string;
  refType: string;
  refId: string;
  active: boolean;
}

// ---- File-type & size policy (defaults; recorded in docs/decisions.md) ----

const DOCUMENT_TYPES: ContentFileType[] = ["pdf", "doc", "docx", "ppt", "pptx", "txt", "md", "csv"];
const VIDEO_TYPES: ContentFileType[] = ["mp4", "mov", "webm"];
const AUDIO_TYPES: ContentFileType[] = ["mp3", "wav"];
const IMAGE_TYPES: ContentFileType[] = ["png", "jpg", "jpeg"];

export const SUPPORTED_FILE_TYPES: ReadonlySet<string> = new Set<string>([
  ...DOCUMENT_TYPES,
  ...VIDEO_TYPES,
  ...AUDIO_TYPES,
  ...IMAGE_TYPES,
  "link",
]);

const MB = 1024 * 1024;
export const MAX_SIZE_BYTES = {
  document: 50 * MB,
  image: 25 * MB,
  audio: 200 * MB,
  video: 500 * MB,
  link: 0,
} as const;

export function isSupportedFileType(fileType: string): fileType is ContentFileType {
  return SUPPORTED_FILE_TYPES.has(fileType);
}

export function maxSizeForType(fileType: ContentFileType): number {
  if (VIDEO_TYPES.includes(fileType)) return MAX_SIZE_BYTES.video;
  if (AUDIO_TYPES.includes(fileType)) return MAX_SIZE_BYTES.audio;
  if (IMAGE_TYPES.includes(fileType)) return MAX_SIZE_BYTES.image;
  if (fileType === "link") return Number.MAX_SAFE_INTEGER;
  return MAX_SIZE_BYTES.document;
}

export function supportedFileTypeList(): string {
  return [...SUPPORTED_FILE_TYPES].sort().join(", ");
}

// ---- Duplicate detection ----

/** Near-duplicate threshold: token-set Jaccard at/above this is "likely duplicate". */
export const NEAR_DUPLICATE_THRESHOLD = 0.8;

export function normalizeTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(Boolean),
  );
}

export function jaccardSimilarity(a: string, b: string): number {
  const ta = normalizeTokens(a);
  const tb = normalizeTokens(b);
  if (ta.size === 0 && tb.size === 0) return 1;
  let intersection = 0;
  for (const t of ta) if (tb.has(t)) intersection++;
  const union = ta.size + tb.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
