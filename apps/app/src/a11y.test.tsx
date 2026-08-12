// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axe from "axe-core";
import { Start } from "./screens/Start";
import { Banner, Button, Card, Chip, Field, TopBar, Trail } from "./components";

/**
 * NFR-A11Y-001 — automated WCAG 2.2 AA checks (axe-core) over the design-system
 * components and the entry screen. This is the automated floor, not the whole
 * story: keyboard walkthroughs and the server-side brand-contrast clamp
 * (never weakened client-side) complete the picture.
 */

async function violations(node: React.ReactElement): Promise<axe.Result[]> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => { root.render(node); });
  const results = await axe.run(host, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] },
  });
  await act(async () => { root.unmount(); });
  host.remove();
  return results.violations;
}

const fmt = (v: axe.Result[]) => v.map((x) => `${x.id}: ${x.help} (${x.nodes.length} nodes)`).join("\n");

describe("NFR-A11Y-001 — axe checks (WCAG 2.2 AA)", () => {
  it("the sign-in / create-school entry screen has no violations", async () => {
    const v = await violations(<Start onStarted={() => undefined} />);
    expect(v, fmt(v)).toHaveLength(0);
  });

  it("the design-system components have no violations", async () => {
    const v = await violations(
      <main>
        <TopBar title="Pathfinder" roleTag="Teacher" />
        <Card>
          <Banner kind="warn">A warning banner</Banner>
          <Field label="Example field" htmlFor="ex"><input id="ex" className="input" defaultValue="x" /></Field>
          <Button variant="primary">Primary</Button>
          <Chip state="draft">Draft</Chip>
          <Chip state="approved">Approved</Chip>
          <Chip state="locked">Computed — locked</Chip>
          <Trail
            steps={[{ key: "a", label: "Step A" }, { key: "b", label: "Step B" }]}
            completed={["a"]} current="b" onJump={() => undefined}
          />
        </Card>
      </main>,
    );
    expect(v, fmt(v)).toHaveLength(0);
  });
});
