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
} from "../domain/content";

/**
 * Persistence port for Milestone 1 content. Async so both the in-memory adapter
 * and the PostgreSQL adapter (ap-southeast-2) satisfy it.
 */
export interface ContentStore {
  // Content items
  insertContentItem(item: ContentItem): Promise<void>;
  getContentItem(id: string): Promise<ContentItem | undefined>;
  updateContentItem(item: ContentItem): Promise<void>;
  listContentItemsBySchool(schoolId: string): Promise<ContentItem[]>;

  // Versions
  insertContentVersion(version: ContentVersion): Promise<void>;
  getContentVersion(id: string): Promise<ContentVersion | undefined>;
  updateContentVersion(version: ContentVersion): Promise<void>;
  listVersionsByItem(contentItemId: string): Promise<ContentVersion[]>;

  // Classification (one current classification per content item)
  upsertClassification(classification: Classification): Promise<void>;
  getClassificationByItem(contentItemId: string): Promise<Classification | undefined>;

  // Ingestion outputs
  insertChunk(chunk: Chunk): Promise<void>;
  listChunksByVersion(versionId: string): Promise<Chunk[]>;
  insertConcept(concept: Concept): Promise<void>;
  listConceptsByVersion(versionId: string): Promise<Concept[]>;

  // Knowledge links
  insertOutcome(outcome: Outcome): Promise<void>;
  getOutcome(id: string): Promise<Outcome | undefined>;
  updateOutcome(outcome: Outcome): Promise<void>;
  listOutcomesBySchool(schoolId: string): Promise<Outcome[]>;
  insertQuestion(question: Question): Promise<void>;
  getQuestion(id: string): Promise<Question | undefined>;
  updateQuestion(question: Question): Promise<void>;
  listQuestionsBySchool(schoolId: string): Promise<Question[]>;
  insertLesson(lesson: Lesson): Promise<void>;
  getLesson(id: string): Promise<Lesson | undefined>;
  listLessonsBySchool(schoolId: string): Promise<Lesson[]>;

  // References (e.g. active assignments) — for archive-in-use warnings
  insertReference(reference: ContentReference): Promise<void>;
  listReferencesByItem(contentItemId: string): Promise<ContentReference[]>;
}
