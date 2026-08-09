import { App } from "aws-cdk-lib";
import { PathfinderStack } from "../src/pathfinderStack";
import { resolveRegion } from "../src/region";

/**
 * CDK app entrypoint. The account comes from the environment; the region is
 * pinned to an approved AU region (Decision 1) and validated by resolveRegion.
 */
const app = new App();
const region = resolveRegion();

new PathfinderStack(app, "PathfinderStack", {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region },
});
