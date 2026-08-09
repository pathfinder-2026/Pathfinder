import { AiServiceLayer } from "./platform/ai/aiServiceLayer";
import { AuditRecorder } from "./platform/audit/auditLog";
import { SystemClock, type Clock } from "./platform/clock";
import {
  InMemoryChannel,
  NotificationService,
  type NotificationChannel,
} from "./platform/notifications/notificationService";
import { InMemoryStore } from "./adapters/memory/inMemoryStore";
import type { DataStore } from "./ports/dataStore";
import { AccountService } from "./services/accountService";
import { AuthService } from "./services/authService";
import { InviteService } from "./services/inviteService";
import { OnboardingService } from "./services/onboardingService";
import { PrincipalService } from "./services/principalService";
import { SchoolService } from "./services/schoolService";

/** Everything an application entrypoint (HTTP, tests) needs, wired together. */
export interface AppContext {
  store: DataStore;
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
}

export interface BuildContextOptions {
  store?: DataStore;
  clock?: Clock;
  channels?: NotificationChannel[];
}

/**
 * Compose the application. Milestone 0 defaults to the in-memory store (no DB
 * provisioned yet) and the in-memory notification channel. Production swaps in
 * the Postgres store (ap-southeast-2) and an SES channel without touching any
 * service — that is the point of the ports.
 */
export function buildContext(options: BuildContextOptions = {}): AppContext {
  const store = options.store ?? new InMemoryStore();
  const clock = options.clock ?? new SystemClock();
  const notificationChannel = new InMemoryChannel();
  const channels = options.channels ?? [notificationChannel];
  const notifications = new NotificationService(clock, channels);
  const audit = new AuditRecorder(clock);
  // Milestone 0: the AI choke point is empty (no provider bound).
  const ai = new AiServiceLayer(null);

  return {
    store,
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
  };
}
