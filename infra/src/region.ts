/**
 * Region pinning (Foundational Decision 1).
 *
 * Pathfinder is hosted in Australian AWS. Every data-bearing service — compute,
 * database, object/file storage, backups/snapshots, logs, email/notifications
 * and monitoring — is confined to an AU region. The IaC pins the region here so
 * residency holds end-to-end and cannot be set to an offshore region.
 */

export const PRIMARY_REGION = "ap-southeast-2" as const; // Sydney
export const ALTERNATIVE_REGION = "ap-southeast-4" as const; // Melbourne

export const APPROVED_AU_REGIONS = [PRIMARY_REGION, ALTERNATIVE_REGION] as const;
export type AuRegion = (typeof APPROVED_AU_REGIONS)[number];

/** Throws if a region is not an approved AU region. */
export function assertAuRegion(region: string): asserts region is AuRegion {
  if (!APPROVED_AU_REGIONS.includes(region as AuRegion)) {
    throw new Error(
      `Region "${region}" is not an approved AU region ` +
        `(${APPROVED_AU_REGIONS.join(", ")}). Data residency (Decision 1) forbids offshore regions.`,
    );
  }
}

/** The pinned deployment region. Reads AWS_REGION but refuses anything offshore. */
export function resolveRegion(requested: string = process.env.AWS_REGION ?? PRIMARY_REGION): AuRegion {
  assertAuRegion(requested);
  return requested;
}
