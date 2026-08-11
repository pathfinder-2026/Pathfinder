/**
 * Milestone 7 — safeguarding configuration (the FR-SAF-002 config surface,
 * collected during the School-Admin `configure-operations` onboarding step).
 *
 * This is a HARD PRECONDITION for Ask for Help: a school with no configured
 * safeguarding contact + SLA cannot enable the tutor at all. The full FR-SAF-002
 * disclosure workflow is Milestone 11; M7 only requires the config to exist and
 * gates on it, and routes safeguarding-classifier hits to the named contact.
 */
export interface SafeguardingConfig {
  schoolId: string;
  contactName: string;
  contactRole: string;
  /** Response SLA in hours for a safeguarding disclosure. */
  slaHours: number;
  afterHoursPolicy: string;
  configuredBy: string;
  configuredAt: string;
}
