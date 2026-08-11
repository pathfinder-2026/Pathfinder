import { ConflictError } from "../domain/errors";
import type { SafeguardingConfig } from "../domain/safeguarding";
import type { AuditRecorder } from "../platform/audit/auditLog";
import type { Clock } from "../platform/clock";
import type { DataStore } from "../ports/dataStore";

export interface SafeguardingInput {
  contactName: string;
  contactRole: string;
  slaHours: number;
  afterHoursPolicy: string;
}

/**
 * Milestone 7 — the safeguarding configuration surface (collected during the
 * School-Admin `configure-operations` onboarding step). This is the FR-SAF-002
 * config; the full disclosure workflow is Milestone 11. Ask for Help gates on
 * `isConfigured` — no configured contact + SLA, no tutor.
 */
export class SafeguardingService {
  constructor(
    private readonly store: DataStore,
    private readonly clock: Clock,
    private readonly audit: AuditRecorder,
  ) {}

  async setConfig(actorId: string, schoolId: string, input: SafeguardingInput): Promise<SafeguardingConfig> {
    await this.requireAdmin(actorId, schoolId);
    if (!input.contactName.trim() || !input.contactRole.trim()) {
      throw new ConflictError("INVALID_CONFIG", "A safeguarding contact name and role are required.");
    }
    if (!(input.slaHours > 0)) {
      throw new ConflictError("INVALID_CONFIG", "A positive response SLA (hours) is required.");
    }
    const config: SafeguardingConfig = {
      schoolId, contactName: input.contactName, contactRole: input.contactRole,
      slaHours: input.slaHours, afterHoursPolicy: input.afterHoursPolicy,
      configuredBy: actorId, configuredAt: this.clock.isoNow(),
    };
    await this.store.saveSafeguardingConfig(config);
    this.audit.append({
      action: "safeguarding.configured", actorId, subjectType: "school", subjectId: schoolId,
      metadata: { contactRole: input.contactRole, slaHours: input.slaHours },
    });
    return config;
  }

  getConfig(schoolId: string): Promise<SafeguardingConfig | undefined> {
    return this.store.getSafeguardingConfig(schoolId);
  }

  async isConfigured(schoolId: string): Promise<boolean> {
    return Boolean(await this.store.getSafeguardingConfig(schoolId));
  }

  private async requireAdmin(actorId: string, schoolId: string): Promise<void> {
    const memberships = await this.store.listMembershipsByUser(actorId);
    if (!memberships.some((m) => m.schoolId === schoolId && m.role === "admin")) {
      throw new ConflictError("NOT_AN_ADMIN", "Only a School Admin may configure safeguarding.");
    }
  }
}
