import type { Sql } from "./pgClient";
import type { BuildContextOptions } from "../../context";
import { PgDataStore } from "./pgDataStore";
import { PgContentStore } from "./pgContentStore";
import { PgSkillGraphStore } from "./pgSkillGraphStore";
import { PgAssessmentStore } from "./pgAssessmentStore";
import { PgActivityStore } from "./pgActivityStore";
import { PgDashboardStore } from "./pgDashboardStore";
import { PgPeerStore } from "./pgPeerStore";
import { PgAgentStore } from "./pgAgentStore";
import { PgWorkspaceStore } from "./pgWorkspaceStore";
import { PgParentStore } from "./pgParentStore";
import { PgReportingStore } from "./pgReportingStore";
import { PgBrandingStore } from "./pgBrandingStore";

/**
 * Compose every PostgreSQL adapter over one postgres-js connection — the same
 * set the acceptance suite runs against (test/helpers.ts). Used by the server
 * entrypoint when a database URL is configured (e.g. Supabase in Sydney).
 *
 * Note: audit and notifications deliberately stay in-memory in BOTH modes for
 * now (see ADR/README "Deferred") — only the data stores swap to Postgres.
 */
export function buildPgStores(sql: Sql): Pick<
  BuildContextOptions,
  | "store" | "contentStore" | "skillGraphStore" | "assessmentStore" | "activityStore"
  | "dashboardStore" | "peerStore" | "agentStore" | "workspaceStore" | "parentStore"
  | "reportingStore" | "brandingStore"
> {
  return {
    store: new PgDataStore(sql),
    contentStore: new PgContentStore(sql),
    skillGraphStore: new PgSkillGraphStore(sql),
    assessmentStore: new PgAssessmentStore(sql),
    activityStore: new PgActivityStore(sql),
    dashboardStore: new PgDashboardStore(sql),
    peerStore: new PgPeerStore(sql),
    agentStore: new PgAgentStore(sql),
    workspaceStore: new PgWorkspaceStore(sql),
    parentStore: new PgParentStore(sql),
    reportingStore: new PgReportingStore(sql),
    brandingStore: new PgBrandingStore(sql),
  };
}
