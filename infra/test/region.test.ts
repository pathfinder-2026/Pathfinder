import { App } from "aws-cdk-lib";
import { describe, expect, it } from "vitest";
import { PathfinderStack } from "../src/pathfinderStack";
import {
  APPROVED_AU_REGIONS,
  PRIMARY_REGION,
  assertAuRegion,
  resolveRegion,
} from "../src/region";

describe("Foundational Decision 1 — region is pinned to AU", () => {
  it("defaults to ap-southeast-2 (Sydney)", () => {
    expect(PRIMARY_REGION).toBe("ap-southeast-2");
    expect(resolveRegion("ap-southeast-2")).toBe("ap-southeast-2");
  });

  it("accepts only approved AU regions", () => {
    expect(APPROVED_AU_REGIONS).toEqual(["ap-southeast-2", "ap-southeast-4"]);
    expect(() => assertAuRegion("ap-southeast-2")).not.toThrow();
    expect(() => assertAuRegion("ap-southeast-4")).not.toThrow();
  });

  it("refuses offshore regions", () => {
    expect(() => assertAuRegion("us-east-1")).toThrow(/not an approved AU region/);
    expect(() => resolveRegion("eu-west-1")).toThrow(/not an approved AU region/);
  });

  it("pins the stack to an AU region", () => {
    const app = new App();
    const stack = new PathfinderStack(app, "TestStack", {
      env: { account: "123456789012", region: "ap-southeast-2" },
    });
    expect(stack.region).toBe("ap-southeast-2");
    // The stack registered no synthesis errors.
    expect(stack.node.metadata.filter((m) => m.type === "aws:cdk:error")).toHaveLength(0);
  });

  it("refuses to construct the stack in an offshore region", () => {
    const app = new App();
    expect(
      () =>
        new PathfinderStack(app, "OffshoreStack", {
          env: { account: "123456789012", region: "us-east-1" },
        }),
    ).toThrow(/not an approved AU region/);
  });
});
