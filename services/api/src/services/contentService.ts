import { ConflictError, NotFoundError, ValidationError } from "../domain/errors";
import {
  isSupportedFileType,
  jaccardSimilarity,
  maxSizeForType,
  NEAR_DUPLICATE_THRESHOLD,
  supportedFileTypeList,
  type ContentFileType,
  type ContentItem,
  type ContentVersion,
  type ShareScope,
} from "../domain/content";
import { approve as govApprove, newDraft } from "../platform/governance/governanceState";
import type { AuditRecorder } from "../platform/audit/auditLog";
import type { Clock } from "../platform/clock";
import { newId } from "../platform/ids";
import type { ContentStore } from "../ports/contentStore";
import type { DataStore } from "../ports/dataStore";
import type { ScannerPort } from "../ports/scannerPort";
import type { StoragePort, StoredObject } from "../ports/storagePort";

export interface UploadSource {
  text?: string;
  scanned?: boolean;
  corrupt?: boolean;
  malware?: boolean;
}

export interface UploadInput {
  title: string;
  fileType: string;
  sizeBytes: number;
  contentHash: string;
  source?: UploadSource;
  share?: ShareScope;
  rightsAttested?: boolean;
}

export type UploadResult =
  | {
      status: "accepted";
      contentItemId: string;
      versionId: string;
      flags: string[];
      duplicateOfId?: string;
    }
  | { status: "rejected"; reason: "unsupported_file_type" | "oversized" | "quarantined"; message: string };

export class ContentService {
  constructor(
    private readonly content: ContentStore,
    private readonly data: DataStore,
    private readonly storage: StoragePort,
    private readonly scanner: ScannerPort,
    private readonly clock: Clock,
    private readonly audit: AuditRecorder,
  ) {}

  /** Upload one or more files; each is validated, scanned and de-duplicated. */
  uploadMany(
    schoolId: string,
    teacherId: string,
    inputs: UploadInput[],
  ): UploadResult[] {
    return inputs.map((input) => this.uploadOne(schoolId, teacherId, input));
  }

  uploadOne(schoolId: string, teacherId: string, input: UploadInput): UploadResult {
    // 1. Unsupported file type — reject listing supported formats.
    if (!isSupportedFileType(input.fileType)) {
      this.audit.append({
        action: "content.upload.rejected",
        actorId: teacherId,
        subjectType: "content",
        subjectId: input.contentHash,
        metadata: { reason: "unsupported_file_type", fileType: input.fileType },
      });
      return {
        status: "rejected",
        reason: "unsupported_file_type",
        message: `Unsupported file type "${input.fileType}". Supported formats: ${supportedFileTypeList()}.`,
      };
    }
    const fileType = input.fileType as ContentFileType;

    // 2. Oversized — stop early with a clear size-limit message.
    const limit = maxSizeForType(fileType);
    if (input.sizeBytes > limit) {
      this.audit.append({
        action: "content.upload.rejected",
        actorId: teacherId,
        subjectType: "content",
        subjectId: input.contentHash,
        metadata: { reason: "oversized", sizeBytes: input.sizeBytes, limit },
      });
      return {
        status: "rejected",
        reason: "oversized",
        message: `File is ${input.sizeBytes} bytes, over the ${limit}-byte limit for ${fileType}.`,
      };
    }

    // Store the source object.
    const storageKey = newId();
    const stored: StoredObject = {
      key: storageKey,
      fileType,
      sizeBytes: input.sizeBytes,
      contentHash: input.contentHash,
      text: input.source?.text,
      scanned: input.source?.scanned,
      corrupt: input.source?.corrupt,
      malware: input.source?.malware,
    };
    this.storage.put(stored);

    // 3. Security scan — reject + quarantine + log on failure.
    if (this.scanner.scan(stored) === "infected") {
      this.audit.append({
        action: "content.upload.quarantined",
        actorId: teacherId,
        subjectType: "content",
        subjectId: storageKey,
        metadata: { reason: "failed_security_scan" },
      });
      return {
        status: "rejected",
        reason: "quarantined",
        message: "File failed the security scan and has been quarantined.",
      };
    }

    // 4. Duplicate detection — flags, never blocks (FR-CONT-001 / FR-CONT-003).
    const duplicateOfId = this.findDuplicate(schoolId, input.contentHash, input.source?.text);
    const flags = duplicateOfId ? ["likely_duplicate"] : [];

    // 5. Create the content item + its first version (draft governance).
    const now = this.clock.isoNow();
    const itemId = newId();
    const version: ContentVersion = {
      id: newId(),
      contentItemId: itemId,
      versionNumber: 1,
      fileType,
      sizeBytes: input.sizeBytes,
      contentHash: input.contentHash,
      storageKey,
      uploadedByTeacherId: teacherId,
      scanStatus: "clean",
      ingestionStatus: "pending",
      createdAt: now,
    };
    const item: ContentItem = {
      id: itemId,
      schoolId,
      ownerTeacherId: teacherId,
      title: input.title,
      currentVersionId: version.id,
      governance: newDraft(),
      rightsAttested: input.rightsAttested ?? false,
      archived: false,
      share: input.share ?? { type: "private" },
      createdAt: now,
    };
    this.content.insertContentVersion(version);
    this.content.insertContentItem(item);
    this.audit.append({
      action: "content.uploaded",
      actorId: teacherId,
      subjectType: "content",
      subjectId: itemId,
      metadata: { fileType, versionId: version.id, flags },
    });

    return duplicateOfId
      ? { status: "accepted", contentItemId: itemId, versionId: version.id, flags, duplicateOfId }
      : { status: "accepted", contentItemId: itemId, versionId: version.id, flags };
  }

  /** Third-party-copyright attestation (FR-CONT-001, NEW v1.4). */
  attestRights(contentItemId: string, teacherId: string): ContentItem {
    const item = this.requireItem(contentItemId);
    const updated = { ...item, rightsAttested: true };
    this.content.updateContentItem(updated);
    this.audit.append({
      action: "content.rights.attested",
      actorId: teacherId,
      subjectType: "content",
      subjectId: contentItemId,
      metadata: {},
    });
    return updated;
  }

  /**
   * Add a new version (a revision). The previous version is retained in history
   * and the new one becomes current. Concurrent saves each become a new version
   * — the later save never silently overwrites the earlier one (FR-CONT-003).
   */
  addVersion(contentItemId: string, teacherId: string, input: UploadInput): ContentVersion {
    const item = this.requireItem(contentItemId);
    if (!isSupportedFileType(input.fileType)) {
      throw new ValidationError(`Unsupported file type "${input.fileType}".`);
    }
    const fileType = input.fileType as ContentFileType;
    const existing = this.content.listVersionsByItem(contentItemId);
    const nextNumber = Math.max(...existing.map((v) => v.versionNumber), 0) + 1;

    const storageKey = newId();
    this.storage.put({
      key: storageKey,
      fileType,
      sizeBytes: input.sizeBytes,
      contentHash: input.contentHash,
      text: input.source?.text,
      scanned: input.source?.scanned,
      corrupt: input.source?.corrupt,
      malware: input.source?.malware,
    });

    const version: ContentVersion = {
      id: newId(),
      contentItemId,
      versionNumber: nextNumber,
      fileType,
      sizeBytes: input.sizeBytes,
      contentHash: input.contentHash,
      storageKey,
      uploadedByTeacherId: teacherId,
      scanStatus: "clean",
      ingestionStatus: "pending",
      createdAt: this.clock.isoNow(),
    };
    this.content.insertContentVersion(version);
    // A revision returns the item to draft until it is re-approved.
    this.content.updateContentItem({ ...item, currentVersionId: version.id, governance: newDraft() });
    this.audit.append({
      action: "content.version.added",
      actorId: teacherId,
      subjectType: "content",
      subjectId: contentItemId,
      metadata: { versionId: version.id, versionNumber: nextNumber },
    });
    return version;
  }

  /**
   * Archive an item. If it is referenced by something in active use (e.g. an
   * assignment), the caller is warned and must confirm first.
   */
  archive(
    contentItemId: string,
    teacherId: string,
    options: { confirm?: boolean } = {},
  ):
    | { archived: true }
    | { archived: false; warning: "in-use"; requiresConfirmation: true; references: string[] } {
    const item = this.requireItem(contentItemId);
    const activeRefs = this.content
      .listReferencesByItem(contentItemId)
      .filter((r) => r.active);
    if (activeRefs.length > 0 && !options.confirm) {
      return {
        archived: false,
        warning: "in-use",
        requiresConfirmation: true,
        references: activeRefs.map((r) => `${r.refType}:${r.refId}`),
      };
    }
    this.content.updateContentItem({ ...item, archived: true });
    this.audit.append({
      action: "content.archived",
      actorId: teacherId,
      subjectType: "content",
      subjectId: contentItemId,
      metadata: { hadActiveReferences: activeRefs.length > 0 },
    });
    return { archived: true };
  }

  /** Share or restrict an item by class or department. */
  setShare(contentItemId: string, teacherId: string, share: ShareScope): ContentItem {
    const item = this.requireItem(contentItemId);
    const updated = { ...item, share };
    this.content.updateContentItem(updated);
    this.audit.append({
      action: "content.share.changed",
      actorId: teacherId,
      subjectType: "content",
      subjectId: contentItemId,
      metadata: { shareType: share.type },
    });
    return updated;
  }

  /** Items in the shared library visible to a given viewer (not archived). */
  browseSharedLibrary(viewerId: string, schoolId: string): ContentItem[] {
    return this.content
      .listContentItemsBySchool(schoolId)
      .filter((item) => !item.archived && this.canView(item, viewerId));
  }

  /** Whether a viewer may see a content item under its current sharing scope. */
  canView(item: ContentItem, viewerId: string): boolean {
    if (item.ownerTeacherId === viewerId) return true;
    switch (item.share.type) {
      case "private":
        return false;
      case "class":
        return this.viewerInClass(viewerId, item.share.classId);
      case "department":
        return this.viewerInDepartment(viewerId, item.share.department);
      default:
        return false;
    }
  }

  /**
   * Approve a content item into the pool. Requires: scan-clean current version,
   * rights attested, successful ingestion, and an approved classification.
   */
  approveContent(contentItemId: string, teacherId: string): ContentItem {
    const item = this.requireItem(contentItemId);
    const reason = this.prerequisiteBlockReason(item);
    if (reason) {
      throw new ConflictError("CONTENT_NOT_APPROVABLE", `Cannot approve content: ${reason}.`);
    }
    const updated = { ...item, governance: govApprove(item.governance, teacherId, this.clock.isoNow()) };
    this.content.updateContentItem(updated);
    this.audit.append({
      action: "content.approved",
      actorId: teacherId,
      subjectType: "content",
      subjectId: contentItemId,
      metadata: {},
    });
    return updated;
  }

  /**
   * The approved-content pool — the ONLY set downstream features (Assessment
   * Builder, Skill Graph mapping, Teacher Agent) may read. Pending, unattested,
   * unreviewed, un-ingested, quarantined or archived items never appear here.
   */
  approvedPool(schoolId: string): ContentItem[] {
    return this.content
      .listContentItemsBySchool(schoolId)
      .filter((item) => this.poolBlockReason(item) === null);
  }

  /**
   * Reasons an item cannot yet be APPROVED into the pool — everything except the
   * governance-approved state itself (which approveContent is about to set).
   */
  prerequisiteBlockReason(item: ContentItem): string | null {
    if (item.archived) return "archived";
    if (!item.rightsAttested) return "rights not attested";
    const version = this.content.getContentVersion(item.currentVersionId);
    if (!version) return "no current version";
    if (version.scanStatus !== "clean") return "current version not scan-clean";
    if (version.ingestionStatus !== "ingested") return "current version not ingested";
    const classification = this.content.getClassificationByItem(item.id);
    if (!classification || classification.status !== "approved") {
      return "classification not approved";
    }
    return null;
  }

  /** null => eligible for the approved pool; otherwise the blocking reason. */
  poolBlockReason(item: ContentItem): string | null {
    const prerequisite = this.prerequisiteBlockReason(item);
    if (prerequisite) return prerequisite;
    if (item.governance.status !== "approved" && item.governance.status !== "published") {
      return "not approved by a teacher";
    }
    return null;
  }

  // ---- helpers ----

  private requireItem(contentItemId: string): ContentItem {
    const item = this.content.getContentItem(contentItemId);
    if (!item) throw new NotFoundError("Content item not found.");
    return item;
  }

  private findDuplicate(schoolId: string, contentHash: string, text?: string): string | undefined {
    for (const item of this.content.listContentItemsBySchool(schoolId)) {
      for (const version of this.content.listVersionsByItem(item.id)) {
        if (version.contentHash === contentHash) return item.id; // exact
      }
      if (text) {
        const current = this.content.getContentVersion(item.currentVersionId);
        const other = current ? this.storage.get(current.storageKey)?.text : undefined;
        if (other && jaccardSimilarity(text, other) >= NEAR_DUPLICATE_THRESHOLD) return item.id;
      }
    }
    return undefined;
  }

  private viewerInClass(viewerId: string, classId: string): boolean {
    const byMembership = this.data
      .listMembershipsByUser(viewerId)
      .some((m) => m.classId === classId);
    if (byMembership) return true;
    const enrolment = this.data.getActiveEnrolmentForStudent(viewerId);
    return enrolment?.classId === classId;
  }

  private viewerInDepartment(viewerId: string, department: string): boolean {
    return this.data
      .listMembershipsByUser(viewerId)
      .some((m) => m.department === department);
  }
}
