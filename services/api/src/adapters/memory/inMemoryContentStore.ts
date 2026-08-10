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
} from "../../domain/content";
import type { ContentStore } from "../../ports/contentStore";
import type { StoragePort, StoredObject } from "../../ports/storagePort";

const clone = <T>(v: T): T => structuredClone(v);

/** In-memory ContentStore for dev/tests. Returns copies to prevent aliasing. */
export class InMemoryContentStore implements ContentStore {
  private items = new Map<string, ContentItem>();
  private versions = new Map<string, ContentVersion>();
  private classifications = new Map<string, Classification>(); // key: contentItemId
  private chunks = new Map<string, Chunk>();
  private concepts = new Map<string, Concept>();
  private outcomes = new Map<string, Outcome>();
  private questions = new Map<string, Question>();
  private lessons = new Map<string, Lesson>();
  private references = new Map<string, ContentReference>();

  insertContentItem(item: ContentItem): void { this.items.set(item.id, clone(item)); }
  getContentItem(id: string): ContentItem | undefined { const v = this.items.get(id); return v ? clone(v) : undefined; }
  updateContentItem(item: ContentItem): void { this.items.set(item.id, clone(item)); }
  listContentItemsBySchool(schoolId: string): ContentItem[] {
    return [...this.items.values()].filter((i) => i.schoolId === schoolId).map(clone);
  }

  insertContentVersion(version: ContentVersion): void { this.versions.set(version.id, clone(version)); }
  getContentVersion(id: string): ContentVersion | undefined { const v = this.versions.get(id); return v ? clone(v) : undefined; }
  updateContentVersion(version: ContentVersion): void { this.versions.set(version.id, clone(version)); }
  listVersionsByItem(contentItemId: string): ContentVersion[] {
    return [...this.versions.values()]
      .filter((v) => v.contentItemId === contentItemId)
      .sort((a, b) => a.versionNumber - b.versionNumber)
      .map(clone);
  }

  upsertClassification(classification: Classification): void {
    this.classifications.set(classification.contentItemId, clone(classification));
  }
  getClassificationByItem(contentItemId: string): Classification | undefined {
    const v = this.classifications.get(contentItemId); return v ? clone(v) : undefined;
  }

  insertChunk(chunk: Chunk): void { this.chunks.set(chunk.id, clone(chunk)); }
  listChunksByVersion(versionId: string): Chunk[] {
    return [...this.chunks.values()].filter((c) => c.contentVersionId === versionId).sort((a, b) => a.order - b.order).map(clone);
  }
  insertConcept(concept: Concept): void { this.concepts.set(concept.id, clone(concept)); }
  listConceptsByVersion(versionId: string): Concept[] {
    return [...this.concepts.values()].filter((c) => c.contentVersionId === versionId).map(clone);
  }

  insertOutcome(outcome: Outcome): void { this.outcomes.set(outcome.id, clone(outcome)); }
  getOutcome(id: string): Outcome | undefined { const v = this.outcomes.get(id); return v ? clone(v) : undefined; }
  updateOutcome(outcome: Outcome): void { this.outcomes.set(outcome.id, clone(outcome)); }
  listOutcomesBySchool(schoolId: string): Outcome[] {
    return [...this.outcomes.values()].filter((o) => o.schoolId === schoolId).map(clone);
  }
  insertQuestion(question: Question): void { this.questions.set(question.id, clone(question)); }
  getQuestion(id: string): Question | undefined { const v = this.questions.get(id); return v ? clone(v) : undefined; }
  updateQuestion(question: Question): void { this.questions.set(question.id, clone(question)); }
  listQuestionsBySchool(schoolId: string): Question[] {
    return [...this.questions.values()].filter((q) => q.schoolId === schoolId).map(clone);
  }
  insertLesson(lesson: Lesson): void { this.lessons.set(lesson.id, clone(lesson)); }
  getLesson(id: string): Lesson | undefined { const v = this.lessons.get(id); return v ? clone(v) : undefined; }
  listLessonsBySchool(schoolId: string): Lesson[] {
    return [...this.lessons.values()].filter((l) => l.schoolId === schoolId).map(clone);
  }

  insertReference(reference: ContentReference): void { this.references.set(reference.id, clone(reference)); }
  listReferencesByItem(contentItemId: string): ContentReference[] {
    return [...this.references.values()].filter((r) => r.contentItemId === contentItemId).map(clone);
  }
}

/** In-memory blob storage (stands in for S3 ap-southeast-2). */
export class InMemoryStorage implements StoragePort {
  private objects = new Map<string, StoredObject>();
  put(object: StoredObject): void { this.objects.set(object.key, clone(object)); }
  get(key: string): StoredObject | undefined { const v = this.objects.get(key); return v ? clone(v) : undefined; }
}
