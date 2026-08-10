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

/** In-memory ContentStore for dev/tests. Async; returns copies to prevent aliasing. */
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

  async insertContentItem(item: ContentItem): Promise<void> { this.items.set(item.id, clone(item)); }
  async getContentItem(id: string): Promise<ContentItem | undefined> { const v = this.items.get(id); return v ? clone(v) : undefined; }
  async updateContentItem(item: ContentItem): Promise<void> { this.items.set(item.id, clone(item)); }
  async listContentItemsBySchool(schoolId: string): Promise<ContentItem[]> {
    return [...this.items.values()].filter((i) => i.schoolId === schoolId).map(clone);
  }

  async insertContentVersion(version: ContentVersion): Promise<void> { this.versions.set(version.id, clone(version)); }
  async getContentVersion(id: string): Promise<ContentVersion | undefined> { const v = this.versions.get(id); return v ? clone(v) : undefined; }
  async updateContentVersion(version: ContentVersion): Promise<void> { this.versions.set(version.id, clone(version)); }
  async listVersionsByItem(contentItemId: string): Promise<ContentVersion[]> {
    return [...this.versions.values()]
      .filter((v) => v.contentItemId === contentItemId)
      .sort((a, b) => a.versionNumber - b.versionNumber)
      .map(clone);
  }

  async upsertClassification(classification: Classification): Promise<void> {
    this.classifications.set(classification.contentItemId, clone(classification));
  }
  async getClassificationByItem(contentItemId: string): Promise<Classification | undefined> {
    const v = this.classifications.get(contentItemId); return v ? clone(v) : undefined;
  }

  async insertChunk(chunk: Chunk): Promise<void> { this.chunks.set(chunk.id, clone(chunk)); }
  async listChunksByVersion(versionId: string): Promise<Chunk[]> {
    return [...this.chunks.values()].filter((c) => c.contentVersionId === versionId).sort((a, b) => a.order - b.order).map(clone);
  }
  async insertConcept(concept: Concept): Promise<void> { this.concepts.set(concept.id, clone(concept)); }
  async listConceptsByVersion(versionId: string): Promise<Concept[]> {
    return [...this.concepts.values()].filter((c) => c.contentVersionId === versionId).map(clone);
  }

  async insertOutcome(outcome: Outcome): Promise<void> { this.outcomes.set(outcome.id, clone(outcome)); }
  async getOutcome(id: string): Promise<Outcome | undefined> { const v = this.outcomes.get(id); return v ? clone(v) : undefined; }
  async updateOutcome(outcome: Outcome): Promise<void> { this.outcomes.set(outcome.id, clone(outcome)); }
  async listOutcomesBySchool(schoolId: string): Promise<Outcome[]> {
    return [...this.outcomes.values()].filter((o) => o.schoolId === schoolId).map(clone);
  }
  async insertQuestion(question: Question): Promise<void> { this.questions.set(question.id, clone(question)); }
  async getQuestion(id: string): Promise<Question | undefined> { const v = this.questions.get(id); return v ? clone(v) : undefined; }
  async updateQuestion(question: Question): Promise<void> { this.questions.set(question.id, clone(question)); }
  async listQuestionsBySchool(schoolId: string): Promise<Question[]> {
    return [...this.questions.values()].filter((q) => q.schoolId === schoolId).map(clone);
  }
  async insertLesson(lesson: Lesson): Promise<void> { this.lessons.set(lesson.id, clone(lesson)); }
  async getLesson(id: string): Promise<Lesson | undefined> { const v = this.lessons.get(id); return v ? clone(v) : undefined; }
  async listLessonsBySchool(schoolId: string): Promise<Lesson[]> {
    return [...this.lessons.values()].filter((l) => l.schoolId === schoolId).map(clone);
  }

  async insertReference(reference: ContentReference): Promise<void> { this.references.set(reference.id, clone(reference)); }
  async listReferencesByItem(contentItemId: string): Promise<ContentReference[]> {
    return [...this.references.values()].filter((r) => r.contentItemId === contentItemId).map(clone);
  }
}

/** In-memory blob storage (stands in for S3 ap-southeast-2). */
export class InMemoryStorage implements StoragePort {
  private objects = new Map<string, StoredObject>();
  put(object: StoredObject): void { this.objects.set(object.key, clone(object)); }
  get(key: string): StoredObject | undefined { const v = this.objects.get(key); return v ? clone(v) : undefined; }
}
