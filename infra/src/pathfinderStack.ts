import { Stack, type StackProps } from "aws-cdk-lib";
import type { Construct } from "constructs";
import { assertAuRegion, PRIMARY_REGION } from "./region";

/**
 * Milestone 0 IaC skeleton. It does NOT provision real resources yet (RDS/
 * Aurora, S3, Bedrock, SES, CloudWatch arrive with the milestones that need
 * them). Its job in M0 is to PIN THE REGION (Decision 1): the stack refuses to
 * synthesize outside an approved AU region, so residency is encoded from the
 * first line of infrastructure.
 */
export class PathfinderStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);
    const region = this.region;
    // Guard against a token/unresolved region and against offshore regions.
    if (!region || region.startsWith("${")) {
      throw new Error("PathfinderStack must be given an explicit AU region via env.region.");
    }
    assertAuRegion(region);
    // The M0 skeleton intentionally provisions no resources yet — its only job
    // is to pin the region. Real resources (RDS/Aurora, S3, SES, Bedrock,
    // CloudWatch) arrive with the milestones that need them.
  }
}

export { PRIMARY_REGION };
