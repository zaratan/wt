import { describe, it, expect } from "vitest";
import { spaceLabel } from "./label.js";
import type { Topology } from "../git/topology.js";

const topologyAt = (umbrella: "umbrella" | "plain"): Topology =>
  ({
    repoName: "tercioapp",
    parent: "/Users/zaratan/Projects/tercio",
    umbrella,
  }) as Topology;

describe("spaceLabel", () => {
  it("names the space after the umbrella when there is one", () => {
    expect(
      spaceLabel(undefined, {
        topology: topologyAt("umbrella"),
        branch: "investigations/import-cmdb",
        slug: "investigations-import-cmdb",
      }),
    ).toBe("tercio - import-cmdb");
  });

  it("names the space after the repo when the parent is not an umbrella", () => {
    expect(
      spaceLabel(undefined, {
        topology: topologyAt("plain"),
        branch: "feat/x",
        slug: "feat-x",
      }),
    ).toBe("tercioapp - x");
  });

  it("prefers --as over the last branch segment", () => {
    expect(
      spaceLabel(undefined, {
        topology: topologyAt("umbrella"),
        branch: "investigations/import-cmdb",
        slug: "investigations-import-cmdb",
        as: "CMDB",
      }),
    ).toBe("tercio - CMDB");
  });

  it("expands every token the configured template uses", () => {
    expect(
      spaceLabel("{repo}/{branch} [{slug}] @{parent} as {as}", {
        topology: topologyAt("umbrella"),
        branch: "feat/deploy",
        slug: "feat-deploy",
        as: "Deploy",
      }),
    ).toBe("tercioapp/feat/deploy [feat-deploy] @tercio as Deploy");
  });

  it("leaves an unknown token alone rather than emptying it", () => {
    expect(
      spaceLabel("{repo} {nope}", {
        topology: topologyAt("plain"),
        branch: "main",
        slug: "main",
      }),
    ).toBe("tercioapp {nope}");
  });
});
