import type { ContentFileType } from "../domain/content";

/**
 * A stored source object (a simulated file). In production this is an object in
 * Amazon S3 (ap-southeast-2, Foundational Decision 1). In dev/tests it is an
 * in-memory record. The simulation flags below let the test suite exercise
 * ingestion/scan branches deterministically without real binaries:
 *   - `text`     : extractable text (a text-based document)
 *   - `scanned`  : a scanned image/PDF with no selectable text (needs OCR)
 *   - `corrupt`  : unreadable/corrupted (ingestion must fail, not hang)
 *   - `malware`  : trips the security scanner
 */
export interface StoredObject {
  key: string;
  fileType: ContentFileType;
  sizeBytes: number;
  contentHash: string;
  text?: string;
  scanned?: boolean;
  corrupt?: boolean;
  malware?: boolean;
}

export interface StoragePort {
  put(object: StoredObject): void;
  get(key: string): StoredObject | undefined;
}
