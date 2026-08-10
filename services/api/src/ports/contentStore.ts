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
 * Persistence port for Milestone 1 content. In-memory adapter backs dev/tests;
 * production is PostgreSQL in ap-southeast-2 (schema in
 * src/adapters/postgres/schema.ts, migration db/migrations/0003_content.sql).
 */
export interface ContentStore {
  // Content items
  insertContentItem(item: ContentItem): void;
  getContentItem(id: string): ContentItem | undefined;
  updateContentItem(item: ContentItem): void;
  listContentItemsBySchool(schoolId: string): ContentItem[];

  // Versions
  insertContentVersion(version: ContentVersion): void;
  getContentVersion(id: string): ContentVersion | undefined;
  updateContentVersion(version: ContentVersion): void;
  listVersionsByItem(contentItemId: string): ContentVersion[];

  // Classification (one current classification per content item)
  upsertClassification(classification: Classification): void;
  getClassificationByItem(contentItemId: string): Classification | undefined;

  // Ingestion outputs
  insertChunk(chunk: Chunk): void;
  listChunksByVersion(versionId: string): Chunk[];
  insertConcept(concept: Concept): void;
  listConceptsByVersion(versionId: string): Concept[];

  // Knowledge links
  insertOutcome(outcome: Outcome): void;
  getOutcome(id: string): Outcome | undefined;
  updateOutcome(outcome: Outcome): void;
  listOutcomesBySchool(schoolId: string): Outcome[];
  insertQuestion(question: Question): void;
  getQuestion(id: string): Question | undefined;
  updateQuestion(question: Question): void;
  listQuestionsBySchool(schoolId: string): Question[];
  insertLesson(lesson: Lesson): void;
  getLesson(id: string): Lesson | undefined;
  listLessonsBySchool(schoolId: string): Lesson[];

  // References (e.g. active assignments) — for archive-in-use warnings
  insertReference(reference: ContentReference): void;
  listReferencesByItem(contentItemId: string): ContentReference[];
}
