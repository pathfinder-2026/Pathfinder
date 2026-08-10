import type {
  Chunk,
  Classification,
  Concept,
  ContentItem,
  ContentReference,
  ContentVersion,
  Lesson,
  Outcome,
  Question,
  ShareScope,
} from "../../domain/content";
import type { ContentStore } from "../../ports/contentStore";
import { iso, isoOrNull, type Sql } from "./pgClient";

/** PostgreSQL ContentStore adapter (ap-southeast-2). */
export class PgContentStore implements ContentStore {
  constructor(private readonly sql: Sql) {}

  async insertContentItem(i: ContentItem): Promise<void> {
    const s = shareCols(i.share);
    await this.sql`insert into content_items
      (id,school_id,owner_teacher_id,title,current_version_id,governance_status,approved_by,approved_at,published_at,rights_attested,archived,share_type,share_class_id,share_department,created_at)
      values (${i.id},${i.schoolId},${i.ownerTeacherId},${i.title},${i.currentVersionId},
        ${i.governance.status},${i.governance.approvedBy},${i.governance.approvedAt},${i.governance.publishedAt},
        ${i.rightsAttested},${i.archived},${s.type},${s.classId},${s.department},${i.createdAt})`;
  }
  async getContentItem(id: string): Promise<ContentItem | undefined> {
    return mapItem((await this.sql`select * from content_items where id=${id}`)[0]);
  }
  async updateContentItem(i: ContentItem): Promise<void> {
    const s = shareCols(i.share);
    await this.sql`update content_items set title=${i.title}, current_version_id=${i.currentVersionId},
      governance_status=${i.governance.status}, approved_by=${i.governance.approvedBy},
      approved_at=${i.governance.approvedAt}, published_at=${i.governance.publishedAt},
      rights_attested=${i.rightsAttested}, archived=${i.archived},
      share_type=${s.type}, share_class_id=${s.classId}, share_department=${s.department} where id=${i.id}`;
  }
  async listContentItemsBySchool(schoolId: string): Promise<ContentItem[]> {
    return (await this.sql`select * from content_items where school_id=${schoolId}`).map(mapItem) as ContentItem[];
  }

  async insertContentVersion(v: ContentVersion): Promise<void> {
    await this.sql`insert into content_versions
      (id,content_item_id,version_number,file_type,size_bytes,content_hash,storage_key,uploaded_by_teacher_id,scan_status,ingestion_status,created_at)
      values (${v.id},${v.contentItemId},${v.versionNumber},${v.fileType},${v.sizeBytes},${v.contentHash},
        ${v.storageKey},${v.uploadedByTeacherId},${v.scanStatus},${v.ingestionStatus},${v.createdAt})`;
  }
  async getContentVersion(id: string): Promise<ContentVersion | undefined> {
    return mapVersion((await this.sql`select * from content_versions where id=${id}`)[0]);
  }
  async updateContentVersion(v: ContentVersion): Promise<void> {
    await this.sql`update content_versions set scan_status=${v.scanStatus}, ingestion_status=${v.ingestionStatus} where id=${v.id}`;
  }
  async listVersionsByItem(contentItemId: string): Promise<ContentVersion[]> {
    return (await this.sql`select * from content_versions where content_item_id=${contentItemId} order by version_number`).map(mapVersion) as ContentVersion[];
  }

  async upsertClassification(c: Classification): Promise<void> {
    // One current classification per content item.
    await this.sql`delete from classifications where content_item_id=${c.contentItemId}`;
    await this.sql`insert into classifications
      (id,content_item_id,subject,year,topic,outcome,difficulty,confidence,low_confidence,status,reviewed_by_teacher_id)
      values (${c.id},${c.contentItemId},${c.subject},${c.year},${c.topic},${c.outcome},${c.difficulty},
        ${String(c.confidence)},${c.lowConfidence},${c.status},${c.reviewedByTeacherId})`;
  }
  async getClassificationByItem(contentItemId: string): Promise<Classification | undefined> {
    return mapClassification((await this.sql`select * from classifications where content_item_id=${contentItemId}`)[0]);
  }

  async insertChunk(ch: Chunk): Promise<void> {
    await this.sql`insert into chunks (id,content_version_id,heading,text,"order")
      values (${ch.id},${ch.contentVersionId},${ch.heading},${ch.text},${ch.order})`;
  }
  async listChunksByVersion(versionId: string): Promise<Chunk[]> {
    return (await this.sql`select * from chunks where content_version_id=${versionId} order by "order"`).map(mapChunk);
  }
  async insertConcept(c: Concept): Promise<void> {
    await this.sql`insert into concepts (id,content_version_id,name) values (${c.id},${c.contentVersionId},${c.name})`;
  }
  async listConceptsByVersion(versionId: string): Promise<Concept[]> {
    return (await this.sql`select * from concepts where content_version_id=${versionId}`).map(
      (r) => ({ id: r.id, contentVersionId: r.content_version_id, name: r.name }),
    );
  }

  async insertOutcome(o: Outcome): Promise<void> {
    await this.sql`insert into outcomes (id,school_id,code,description,deprecated)
      values (${o.id},${o.schoolId},${o.code},${o.description},${o.deprecated})`;
  }
  async getOutcome(id: string): Promise<Outcome | undefined> {
    return mapOutcome((await this.sql`select * from outcomes where id=${id}`)[0]);
  }
  async updateOutcome(o: Outcome): Promise<void> {
    await this.sql`update outcomes set code=${o.code}, description=${o.description}, deprecated=${o.deprecated} where id=${o.id}`;
  }
  async listOutcomesBySchool(schoolId: string): Promise<Outcome[]> {
    return (await this.sql`select * from outcomes where school_id=${schoolId}`).map(mapOutcome) as Outcome[];
  }
  async insertQuestion(q: Question): Promise<void> {
    await this.sql`insert into questions (id,school_id,text,outcome_ids)
      values (${q.id},${q.schoolId},${q.text},${this.sql.json(q.outcomeIds)})`;
  }
  async getQuestion(id: string): Promise<Question | undefined> {
    return mapQuestion((await this.sql`select * from questions where id=${id}`)[0]);
  }
  async updateQuestion(q: Question): Promise<void> {
    await this.sql`update questions set text=${q.text}, outcome_ids=${this.sql.json(q.outcomeIds)} where id=${q.id}`;
  }
  async listQuestionsBySchool(schoolId: string): Promise<Question[]> {
    return (await this.sql`select * from questions where school_id=${schoolId}`).map(mapQuestion) as Question[];
  }
  async insertLesson(l: Lesson): Promise<void> {
    await this.sql`insert into lessons (id,school_id,title,question_ids,outcome_ids)
      values (${l.id},${l.schoolId},${l.title},${this.sql.json(l.questionIds)},${this.sql.json(l.outcomeIds)})`;
  }
  async getLesson(id: string): Promise<Lesson | undefined> {
    return mapLesson((await this.sql`select * from lessons where id=${id}`)[0]);
  }
  async listLessonsBySchool(schoolId: string): Promise<Lesson[]> {
    return (await this.sql`select * from lessons where school_id=${schoolId}`).map(mapLesson) as Lesson[];
  }

  async insertReference(r: ContentReference): Promise<void> {
    await this.sql`insert into content_references (id,content_item_id,ref_type,ref_id,active)
      values (${r.id},${r.contentItemId},${r.refType},${r.refId},${r.active})`;
  }
  async listReferencesByItem(contentItemId: string): Promise<ContentReference[]> {
    return (await this.sql`select * from content_references where content_item_id=${contentItemId}`).map(
      (r) => ({ id: r.id, contentItemId: r.content_item_id, refType: r.ref_type, refId: r.ref_id, active: r.active }),
    );
  }
}

// ---- mappers ----
type Row = Record<string, any>;

function shareCols(s: ShareScope): { type: string; classId: string | null; department: string | null } {
  if (s.type === "class") return { type: "class", classId: s.classId, department: null };
  if (s.type === "department") return { type: "department", classId: null, department: s.department };
  return { type: "private", classId: null, department: null };
}
function mapShare(r: Row): ShareScope {
  if (r.share_type === "class") return { type: "class", classId: r.share_class_id };
  if (r.share_type === "department") return { type: "department", department: r.share_department };
  return { type: "private" };
}
function mapItem(r: Row | undefined): ContentItem | undefined {
  return r && {
    id: r.id,
    schoolId: r.school_id,
    ownerTeacherId: r.owner_teacher_id,
    title: r.title,
    currentVersionId: r.current_version_id,
    governance: {
      status: r.governance_status,
      approvedBy: r.approved_by,
      approvedAt: isoOrNull(r.approved_at),
      publishedAt: isoOrNull(r.published_at),
    },
    rightsAttested: r.rights_attested,
    archived: r.archived,
    share: mapShare(r),
    createdAt: iso(r.created_at),
  };
}
function mapVersion(r: Row | undefined): ContentVersion | undefined {
  return r && {
    id: r.id,
    contentItemId: r.content_item_id,
    versionNumber: Number(r.version_number),
    fileType: r.file_type,
    sizeBytes: Number(r.size_bytes),
    contentHash: r.content_hash,
    storageKey: r.storage_key,
    uploadedByTeacherId: r.uploaded_by_teacher_id,
    scanStatus: r.scan_status,
    ingestionStatus: r.ingestion_status,
    createdAt: iso(r.created_at),
  };
}
function mapClassification(r: Row | undefined): Classification | undefined {
  return r && {
    id: r.id,
    contentItemId: r.content_item_id,
    subject: r.subject,
    year: Number(r.year),
    topic: r.topic,
    outcome: r.outcome,
    difficulty: r.difficulty,
    confidence: Number(r.confidence),
    lowConfidence: r.low_confidence,
    status: r.status,
    reviewedByTeacherId: r.reviewed_by_teacher_id,
  };
}
function mapChunk(r: Row): Chunk {
  return { id: r.id, contentVersionId: r.content_version_id, heading: r.heading, text: r.text, order: Number(r.order) };
}
function mapOutcome(r: Row | undefined): Outcome | undefined {
  return r && { id: r.id, schoolId: r.school_id, code: r.code, description: r.description, deprecated: r.deprecated };
}
function mapQuestion(r: Row | undefined): Question | undefined {
  return r && { id: r.id, schoolId: r.school_id, text: r.text, outcomeIds: r.outcome_ids };
}
function mapLesson(r: Row | undefined): Lesson | undefined {
  return r && { id: r.id, schoolId: r.school_id, title: r.title, questionIds: r.question_ids, outcomeIds: r.outcome_ids };
}
