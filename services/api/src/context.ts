import { AiServiceLayer } from "./platform/ai/aiServiceLayer";
import { AuditRecorder } from "./platform/audit/auditLog";
import { SystemClock, type Clock } from "./platform/clock";
import {
  InMemoryChannel,
  NotificationService,
  type NotificationChannel,
} from "./platform/notifications/notificationService";
import { InMemoryStore } from "./adapters/memory/inMemoryStore";
import {
  InMemoryContentStore,
  InMemoryStorage,
} from "./adapters/memory/inMemoryContentStore";
import type { DataStore } from "./ports/dataStore";
import type { ContentStore } from "./ports/contentStore";
import type { StoragePort } from "./ports/storagePort";
import type { ScannerPort } from "./ports/scannerPort";
import type { TextExtractorPort } from "./ports/textExtractorPort";
import { InMemoryScanner } from "./ports/scannerPort";
import { InMemoryTextExtractor } from "./ports/textExtractorPort";
import { LocalClassifierProvider, type AiProvider } from "./ports/aiProvider";
import { AccountService } from "./services/accountService";
import { AuthService } from "./services/authService";
import { InviteService } from "./services/inviteService";
import { OnboardingService } from "./services/onboardingService";
import { PrincipalService } from "./services/principalService";
import { SchoolService } from "./services/schoolService";
import { ContentService } from "./services/contentService";
import { ClassificationService } from "./services/classificationService";
import { IngestionService } from "./services/ingestionService";
import { KnowledgeService } from "./services/knowledgeService";

/** Everything an application entrypoint (HTTP, tests) needs, wired together. */
export interface AppContext {
  store: DataStore;
  contentStore: ContentStore;
  storage: StoragePort;
  scanner: ScannerPort;
  extractor: TextExtractorPort;
  clock: Clock;
  audit: AuditRecorder;
  notifications: NotificationService;
  notificationChannel: InMemoryChannel;
  ai: AiServiceLayer;
  schools: SchoolService;
  accounts: AccountService;
  principals: PrincipalService;
  invites: InviteService;
  auth: AuthService;
  onboarding: OnboardingService;
  content: ContentService;
  classification: ClassificationService;
  ingestion: IngestionService;
  knowledge: KnowledgeService;
}

export interface BuildContextOptions {
  store?: DataStore;
  contentStore?: ContentStore;
  storage?: StoragePort;
  scanner?: ScannerPort;
  extractor?: TextExtractorPort;
  clock?: Clock;
  channels?: NotificationChannel[];
  /**
   * AI provider. Defaults to the local deterministic provider (no network egress)
   * because live Bedrock verification is gated on AWS credentials (ADR-0013).
   * Production injects a guarded BedrockProvider (ap-southeast-2).
   */
  aiProvider?: AiProvider;
}

/**
 * Compose the application. Milestone 0/1 default to in-memory adapters (no DB or
 * object store provisioned yet) and the local AI provider. Production swaps in
 * Postgres + S3 + Bedrock (all ap-southeast-2) without touching any service.
 */
export function buildContext(options: BuildContextOptions = {}): AppContext {
  const store = options.store ?? new InMemoryStore();
  const contentStore = options.contentStore ?? new InMemoryContentStore();
  const storage = options.storage ?? new InMemoryStorage();
  const scanner = options.scanner ?? new InMemoryScanner();
  const extractor = options.extractor ?? new InMemoryTextExtractor();
  const clock = options.clock ?? new SystemClock();
  const notificationChannel = new InMemoryChannel();
  const channels = options.channels ?? [notificationChannel];
  const notifications = new NotificationService(clock, channels);
  const audit = new AuditRecorder(clock);

  // AI service layer is operational in M1 via a provider (local by default).
  const aiProvider = options.aiProvider ?? new LocalClassifierProvider();
  const ai = new AiServiceLayer(aiProvider, audit);

  return {
    store,
    contentStore,
    storage,
    scanner,
    extractor,
    clock,
    audit,
    notifications,
    notificationChannel,
    ai,
    schools: new SchoolService(store, clock, audit),
    accounts: new AccountService(store, clock, audit),
    principals: new PrincipalService(store, audit),
    invites: new InviteService(store, clock, audit, notifications),
    auth: new AuthService(store, clock, audit),
    onboarding: new OnboardingService(store, audit),
    content: new ContentService(contentStore, store, storage, scanner, clock, audit),
    classification: new ClassificationService(contentStore, storage, ai, audit),
    ingestion: new IngestionService(contentStore, storage, extractor, clock, audit),
    knowledge: new KnowledgeService(contentStore, audit),
  };
}
