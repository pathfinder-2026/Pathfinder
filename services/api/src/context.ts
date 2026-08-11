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
import { InMemorySkillGraphStore } from "./adapters/memory/inMemorySkillGraphStore";
import { InMemoryAssessmentStore } from "./adapters/memory/inMemoryAssessmentStore";
import { InMemoryActivityStore } from "./adapters/memory/inMemoryActivityStore";
import { InMemoryDashboardStore } from "./adapters/memory/inMemoryDashboardStore";
import { InMemoryPeerStore } from "./adapters/memory/inMemoryPeerStore";
import { InMemoryAgentStore } from "./adapters/memory/inMemoryAgentStore";
import { InMemoryWorkspaceStore } from "./adapters/memory/inMemoryWorkspaceStore";
import { InMemoryParentStore } from "./adapters/memory/inMemoryParentStore";
import { InMemoryReportingStore } from "./adapters/memory/inMemoryReportingStore";
import { InMemoryBrandingStore } from "./adapters/memory/inMemoryBrandingStore";
import type { DataStore } from "./ports/dataStore";
import type { ContentStore } from "./ports/contentStore";
import type { SkillGraphStore } from "./ports/skillGraphStore";
import type { AssessmentStore } from "./ports/assessmentStore";
import type { ActivityStore } from "./ports/activityStore";
import type { DashboardStore } from "./ports/dashboardStore";
import type { PeerStore } from "./ports/peerStore";
import type { AgentStore } from "./ports/agentStore";
import type { WorkspaceStore } from "./ports/workspaceStore";
import type { ParentStore } from "./ports/parentStore";
import type { ReportingStore } from "./ports/reportingStore";
import type { BrandingStore } from "./ports/brandingStore";
import type { StoragePort } from "./ports/storagePort";
import type { ScannerPort } from "./ports/scannerPort";
import type { TextExtractorPort } from "./ports/textExtractorPort";
import { InMemoryScanner } from "./ports/scannerPort";
import { InMemoryTextExtractor } from "./ports/textExtractorPort";
import { LocalClassifierProvider, type AiProvider } from "./ports/aiProvider";
import { LocalIdentityProvider, type IdentityProviderPort } from "./ports/identityProviderPort";
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
import { SkillGraphService } from "./services/skillGraphService";
import { MappingService } from "./services/mappingService";
import { AssessmentService } from "./services/assessmentService";
import { SyntheticService } from "./services/syntheticService";
import { TeacherDashboardService } from "./services/teacherDashboardService";
import { CohortService } from "./services/cohortService";
import { AdaptiveEngine } from "./services/adaptiveEngine";
import { PeerTestService } from "./services/peerTestService";
import { PeerReviewService } from "./services/peerReviewService";
import { AgentService } from "./services/agentService";
import { SafeguardingService } from "./services/safeguardingService";
import { StudentWorkspaceService } from "./services/studentWorkspaceService";
import { AskForHelpService } from "./services/askForHelpService";
import { ParentService } from "./services/parentService";
import { PrincipalDashboardService } from "./services/principalDashboardService";
import { BehaviouralService } from "./services/behaviouralService";
import { CoCurricularService } from "./services/coCurricularService";
import { ReportingService } from "./services/reportingService";
import { GovernanceService } from "./services/governanceService";
import { CsvImportService } from "./services/csvImportService";
import { SsoService } from "./services/ssoService";
import { BrandingService } from "./services/brandingService";

/** Everything an application entrypoint (HTTP, tests) needs, wired together. */
export interface AppContext {
  store: DataStore;
  contentStore: ContentStore;
  skillGraphStore: SkillGraphStore;
  assessmentStore: AssessmentStore;
  activityStore: ActivityStore;
  dashboardStore: DashboardStore;
  peerStore: PeerStore;
  agentStore: AgentStore;
  workspaceStore: WorkspaceStore;
  parentStore: ParentStore;
  reportingStore: ReportingStore;
  brandingStore: BrandingStore;
  storage: StoragePort;
  scanner: ScannerPort;
  extractor: TextExtractorPort;
  clock: Clock;
  audit: AuditRecorder;
  notifications: NotificationService;
  notificationChannel: InMemoryChannel;
  ai: AiServiceLayer;
  /** SSO identity provider seam (FR-INT-001). In-memory + deterministic by default. */
  idp: IdentityProviderPort;
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
  skillGraph: SkillGraphService;
  mapping: MappingService;
  assessment: AssessmentService;
  synthetic: SyntheticService;
  dashboard: TeacherDashboardService;
  cohorts: CohortService;
  adaptive: AdaptiveEngine;
  peerTests: PeerTestService;
  peerReviews: PeerReviewService;
  agent: AgentService;
  safeguarding: SafeguardingService;
  studentWorkspace: StudentWorkspaceService;
  askForHelp: AskForHelpService;
  parents: ParentService;
  principalDashboard: PrincipalDashboardService;
  behavioural: BehaviouralService;
  coCurricular: CoCurricularService;
  reporting: ReportingService;
  governance: GovernanceService;
  csvImport: CsvImportService;
  sso: SsoService;
  branding: BrandingService;
}

export interface BuildContextOptions {
  store?: DataStore;
  contentStore?: ContentStore;
  skillGraphStore?: SkillGraphStore;
  assessmentStore?: AssessmentStore;
  activityStore?: ActivityStore;
  dashboardStore?: DashboardStore;
  peerStore?: PeerStore;
  agentStore?: AgentStore;
  workspaceStore?: WorkspaceStore;
  parentStore?: ParentStore;
  reportingStore?: ReportingStore;
  brandingStore?: BrandingStore;
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
  /**
   * SSO identity provider. Defaults to the local deterministic provider (no
   * network egress); production injects a real Google/Microsoft OIDC verifier
   * (deferred — see docs/decisions.md ADR-0029).
   */
  idp?: IdentityProviderPort;
}

/**
 * Compose the application. Milestone 0/1 default to in-memory adapters (no DB or
 * object store provisioned yet) and the local AI provider. Production swaps in
 * Postgres + S3 + Bedrock (all ap-southeast-2) without touching any service.
 */
export function buildContext(options: BuildContextOptions = {}): AppContext {
  const store = options.store ?? new InMemoryStore();
  const contentStore = options.contentStore ?? new InMemoryContentStore();
  const skillGraphStore = options.skillGraphStore ?? new InMemorySkillGraphStore();
  const assessmentStore = options.assessmentStore ?? new InMemoryAssessmentStore();
  const activityStore = options.activityStore ?? new InMemoryActivityStore();
  const dashboardStore = options.dashboardStore ?? new InMemoryDashboardStore();
  const peerStore = options.peerStore ?? new InMemoryPeerStore();
  const agentStore = options.agentStore ?? new InMemoryAgentStore();
  const workspaceStore = options.workspaceStore ?? new InMemoryWorkspaceStore();
  const parentStore = options.parentStore ?? new InMemoryParentStore();
  const reportingStore = options.reportingStore ?? new InMemoryReportingStore();
  const brandingStore = options.brandingStore ?? new InMemoryBrandingStore();
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

  // SSO identity provider seam (local deterministic by default).
  const idp = options.idp ?? new LocalIdentityProvider();

  const contentService = new ContentService(contentStore, store, storage, scanner, clock, audit);
  const skillGraph = new SkillGraphService(skillGraphStore, clock, audit);
  const accountService = new AccountService(store, clock, audit);

  return {
    store,
    contentStore,
    skillGraphStore,
    assessmentStore,
    activityStore,
    dashboardStore,
    peerStore,
    agentStore,
    workspaceStore,
    parentStore,
    reportingStore,
    brandingStore,
    storage,
    scanner,
    extractor,
    clock,
    audit,
    notifications,
    notificationChannel,
    ai,
    idp,
    schools: new SchoolService(store, clock, audit),
    accounts: accountService,
    principals: new PrincipalService(store, audit),
    invites: new InviteService(store, clock, audit, notifications),
    auth: new AuthService(store, clock, audit),
    onboarding: new OnboardingService(store, audit),
    content: contentService,
    classification: new ClassificationService(contentStore, storage, ai, audit),
    ingestion: new IngestionService(contentStore, storage, extractor, clock, audit),
    knowledge: new KnowledgeService(contentStore, audit),
    skillGraph,
    mapping: new MappingService(skillGraphStore, contentStore, contentService, clock, audit),
    assessment: new AssessmentService(assessmentStore, contentService, contentStore, skillGraphStore, ai, clock, audit),
    synthetic: new SyntheticService(store, activityStore, skillGraphStore, clock, audit),
    dashboard: new TeacherDashboardService(activityStore, dashboardStore, skillGraphStore, contentService, store, clock, audit),
    cohorts: new CohortService(activityStore, dashboardStore, store, clock, audit),
    adaptive: new AdaptiveEngine(activityStore, assessmentStore, store, clock, audit, notifications),
    peerTests: new PeerTestService(peerStore, contentService, contentStore, skillGraphStore, store, clock, audit),
    peerReviews: new PeerReviewService(peerStore, store, clock, audit),
    agent: new AgentService(agentStore, ai, contentService, contentStore, skillGraphStore, activityStore, store, clock, audit),
    safeguarding: new SafeguardingService(store, clock, audit),
    studentWorkspace: new StudentWorkspaceService(workspaceStore, store, clock, audit, notifications),
    askForHelp: new AskForHelpService(workspaceStore, store, assessmentStore, contentService, contentStore, skillGraphStore, ai, clock, audit, notifications),
    parents: new ParentService(parentStore, store, activityStore, workspaceStore, skillGraphStore, ai, clock, audit, notifications),
    principalDashboard: new PrincipalDashboardService(store, activityStore, assessmentStore, agentStore, workspaceStore, clock, audit),
    behavioural: new BehaviouralService(reportingStore, store, clock, audit),
    coCurricular: new CoCurricularService(reportingStore, store, clock, audit),
    reporting: new ReportingService(reportingStore, activityStore, assessmentStore, agentStore, parentStore, store, skillGraphStore, clock, audit),
    governance: new GovernanceService(store, workspaceStore, reportingStore, activityStore, clock, audit),
    csvImport: new CsvImportService(store, accountService, clock, audit),
    sso: new SsoService(store, idp, clock, audit),
    branding: new BrandingService(brandingStore, store, scanner, clock, audit),
  };
}
