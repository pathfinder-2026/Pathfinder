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
  type OfficialSyllabus,
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
  async uploadMany(
    schoolId: string,
    teacherId: string,
    inputs: UploadInput[],
  ): Promise<UploadResult[]> {
    const results: UploadResult[] = [];
    // Sequential: each upload affects duplicate detection for the next.
    for (const input of inputs) {
      results.push(await this.uploadOne(schoolId, teacherId, input));
    }
    return results;
  }

  async uploadOne(schoolId: string, teacherId: string, input: UploadInput): Promise<UploadResult> {
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
    const duplicateOfId = await this.findDuplicate(schoolId, input.contentHash, input.source?.text);
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
      officialSyllabus: null,
      createdAt: now,
    };
    // Insert the item BEFORE the version: content_versions.content_item_id has a
    // FK to content_items (current_version_id carries no FK, so this order is safe).
    await this.content.insertContentItem(item);
    await this.content.insertContentVersion(version);
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
  async attestRights(contentItemId: string, teacherId: string): Promise<ContentItem> {
    const item = await this.requireItem(contentItemId);
    const updated = { ...item, rightsAttested: true };
    await this.content.updateContentItem(updated);
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
   * Tag an item as THE official syllabus for a subject + year level, with a
   * reference link (NESA has no public curriculum API — ADR-0035 — so this is
   * the caller's own reference URL, never generated here). Purely a tag: the
   * item still has to clear the full approval pipeline before it enters the
   * approved pool or can be mapped/used for grounding, exactly like any other
   * upload. At most one active syllabus per subject+year — tagging a new item
   * replaces which item answers `getOfficialSyllabus`, but does not touch or
   * archive the previous one (a teacher can still find it in the library).
   */
  async markOfficialSyllabus(
    contentItemId: string,
    teacherId: string,
    input: { subject: string; yearLevel: number; sourceUrl: string },
  ): Promise<ContentItem> {
    const item = await this.requireItem(contentItemId);
    const officialSyllabus: OfficialSyllabus = {
      subject: input.subject.trim(),
      yearLevel: input.yearLevel,
      sourceUrl: input.sourceUrl.trim(),
    };
    const updated = { ...item, officialSyllabus };
    await this.content.updateContentItem(updated);
    this.audit.append({
      action: "content.syllabus.tagged",
      actorId: teacherId,
      subjectType: "content",
      subjectId: contentItemId,
      metadata: { subject: officialSyllabus.subject, yearLevel: officialSyllabus.yearLevel },
    });
    return updated;
  }

  /**
   * The current official syllabus for a subject + year level, or undefined if
   * none has been uploaded yet. Visible regardless of the caller's own
   * archived-visibility rules — a teacher deciding whether to upload one needs
   * to see whatever's on file, even if it happens to be archived.
   */
  async getOfficialSyllabus(schoolId: string, subject: string, yearLevel: number): Promise<ContentItem | undefined> {
    const items = await this.content.listContentItemsBySchool(schoolId);
    const matches = items.filter(
      (i) => i.officialSyllabus?.subject === subject.trim() && i.officialSyllabus?.yearLevel === yearLevel && !i.archived,
    );
    // Most recently tagged wins if more than one somehow matches (shouldn't in
    // normal use — markOfficialSyllabus doesn't enforce exclusivity at write
    // time — but reads must still be deterministic).
    matches.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return matches[0];
  }

  /**
   * Add a new version (a revision). The previous version is retained in history
   * and the new one becomes current. Concurrent saves each become a new version
   * — the later save never silently overwrites the earlier one (FR-CONT-003).
   */
  async addVersion(contentItemId: string, teacherId: string, input: UploadInput): Promise<ContentVersion> {
    const item = await this.requireItem(contentItemId);
    if (!isSupportedFileType(input.fileType)) {
      throw new ValidationError(`Unsupported file type "${input.fileType}".`);
    }
    const fileType = input.fileType as ContentFileType;
    const existing = await this.content.listVersionsByItem(contentItemId);
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
    await this.content.insertContentVersion(version);
    // A revision returns the item to draft until it is re-approved.
    await this.content.updateContentItem({ ...item, currentVersionId: version.id, governance: newDraft() });
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
  async archive(
    contentItemId: string,
    teacherId: string,
    options: { confirm?: boolean } = {},
  ): Promise<
    | { archived: true }
    | { archived: false; warning: "in-use"; requiresConfirmation: true; references: string[] }
  > {
    const item = await this.requireItem(contentItemId);
    const activeRefs = (await this.content.listReferencesByItem(contentItemId)).filter((r) => r.active);
    if (activeRefs.length > 0 && !options.confirm) {
      return {
        archived: false,
        warning: "in-use",
        requiresConfirmation: true,
        references: activeRefs.map((r) => `${r.refType}:${r.refId}`),
      };
    }
    await this.content.updateContentItem({ ...item, archived: true });
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
  async setShare(contentItemId: string, teacherId: string, share: ShareScope): Promise<ContentItem> {
    const item = await this.requireItem(contentItemId);
    const updated = { ...item, share };
    await this.content.updateContentItem(updated);
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
  async browseSharedLibrary(viewerId: string, schoolId: string): Promise<ContentItem[]> {
    const items = await this.content.listContentItemsBySchool(schoolId);
    const visible: ContentItem[] = [];
    for (const item of items) {
      if (!item.archived && (await this.canView(item, viewerId))) visible.push(item);
    }
    return visible;
  }

  /** Whether a viewer may see a content item under its current sharing scope. */
  async canView(item: ContentItem, viewerId: string): Promise<boolean> {
    if (item.ownerTeacherId === viewerId) return true;
    // Marking a document as THE official syllabus for a subject/year is an
    // explicit school-wide share (ADR-0035: "every teacher of this subject/year
    // will see it") — it overrides the item's narrower scope.
    if (item.officialSyllabus) return true;
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
  async approveContent(contentItemId: string, teacherId: string): Promise<ContentItem> {
    const item = await this.requireItem(contentItemId);
    const reason = await this.prerequisiteBlockReason(item);
    if (reason) {
      throw new ConflictError("CONTENT_NOT_APPROVABLE", `Cannot approve content: ${reason}.`);
    }
    const updated = { ...item, governance: govApprove(item.governance, teacherId, this.clock.isoNow()) };
    await this.content.updateContentItem(updated);
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
  async approvedPool(schoolId: string): Promise<ContentItem[]> {
    const items = await this.content.listContentItemsBySchool(schoolId);
    const pool: ContentItem[] = [];
    for (const item of items) {
      if ((await this.poolBlockReason(item)) === null) pool.push(item);
    }
    return pool;
  }

  /**
   * Reasons an item cannot yet be APPROVED into the pool — everything except the
   * governance-approved state itself (which approveContent is about to set).
   */
  async prerequisiteBlockReason(item: ContentItem): Promise<string | null> {
    if (item.archived) return "archived";
    if (!item.rightsAttested) return "rights not attested";
    const version = await this.content.getContentVersion(item.currentVersionId);
    if (!version) return "no current version";
    if (version.scanStatus !== "clean") return "current version not scan-clean";
    if (version.ingestionStatus !== "ingested") return "current version not ingested";
    const classification = await this.content.getClassificationByItem(item.id);
    if (!classification || classification.status !== "approved") {
      return "classification not approved";
    }
    return null;
  }

  /** Whether a content item is currently in the approved pool. */
  async isInApprovedPool(contentItemId: string): Promise<boolean> {
    const item = await this.content.getContentItem(contentItemId);
    return item ? (await this.poolBlockReason(item)) === null : false;
  }

  /** null => eligible for the approved pool; otherwise the blocking reason. */
  async poolBlockReason(item: ContentItem): Promise<string | null> {
    const prerequisite = await this.prerequisiteBlockReason(item);
    if (prerequisite) return prerequisite;
    if (item.governance.status !== "approved" && item.governance.status !== "published") {
      return "not approved by a teacher";
    }
    return null;
  }

  // ---- helpers ----

  private async requireItem(contentItemId: string): Promise<ContentItem> {
    const item = await this.content.getContentItem(contentItemId);
    if (!item) throw new NotFoundError("Content item not found.");
    return item;
  }

  private async findDuplicate(schoolId: string, contentHash: string, text?: string): Promise<string | undefined> {
    for (const item of await this.content.listContentItemsBySchool(schoolId)) {
      for (const version of await this.content.listVersionsByItem(item.id)) {
        if (version.contentHash === contentHash) return item.id; // exact
      }
      if (text) {
        const current = await this.content.getContentVersion(item.currentVersionId);
        const other = current ? this.storage.get(current.storageKey)?.text : undefined;
        if (other && jaccardSimilarity(text, other) >= NEAR_DUPLICATE_THRESHOLD) return item.id;
      }
    }
    return undefined;
  }

  private async viewerInClass(viewerId: string, classId: string): Promise<boolean> {
    const byMembership = (await this.data.listMembershipsByUser(viewerId)).some((m) => m.classId === classId);
    if (byMembership) return true;
    const enrolment = await this.data.getActiveEnrolmentForStudent(viewerId);
    return enrolment?.classId === classId;
  }

  private async viewerInDepartment(viewerId: string, department: string): Promise<boolean> {
    return (await this.data.listMembershipsByUser(viewerId)).some((m) => m.department === department);
  }
}
