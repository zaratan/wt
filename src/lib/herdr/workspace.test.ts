import { describe, it, expect } from "vitest";
import { agentNameFrom, whyNot } from "./workspace.js";
import { collectPaneIds } from "./types.js";

describe("agentNameFrom", () => {
  it("lowercases and collapses separators", () => {
    expect(agentNameFrom("app - Space", [])).toBe("app-space");
    expect(agentNameFrom("tercio - CMDB", [])).toBe("tercio-cmdb");
  });

  it("drops a leading non-letter, which herdr rejects", () => {
    expect(agentNameFrom("2fa - work", [])).toBe("fa-work");
  });

  it("falls back when nothing usable is left", () => {
    expect(agentNameFrom("---", [])).toBe("wt");
  });

  it("suffixes to avoid a living agent of the same name", () => {
    expect(agentNameFrom("app - Space", ["app-space"])).toBe("app-space-2");
    expect(agentNameFrom("app - Space", ["app-space", "app-space-2"])).toBe(
      "app-space-3",
    );
  });

  it("stays within herdr's 32 characters", () => {
    expect(agentNameFrom("x".repeat(80), []).length).toBeLessThanOrEqual(32);
  });
});

describe("collectPaneIds", () => {
  it("pairs each label with its pane id across the tree", () => {
    const ids = collectPaneIds({
      type: "split",
      first: { type: "pane", label: "wt:0", pane_id: "w1:p2" },
      second: {
        type: "split",
        first: { type: "pane", label: "wt:1", pane_id: "w1:p3" },
        second: { type: "pane", label: "wt:2", pane_id: "w1:p4" },
      },
    });
    expect([...ids]).toEqual([
      ["wt:0", "w1:p2"],
      ["wt:1", "w1:p3"],
      ["wt:2", "w1:p4"],
    ]);
  });

  it("skips a pane whose id came back null", () => {
    const ids = collectPaneIds({
      type: "split",
      first: { type: "pane", label: "wt:0", pane_id: null },
      second: { type: "pane", label: "wt:1", pane_id: "w1:p3" },
    });
    expect([...ids]).toEqual([["wt:1", "w1:p3"]]);
  });
});

describe("whyNot", () => {
  it("carries the code and the message of a refusal", () => {
    expect(
      whyNot({
        kind: "error",
        error: { code: "pane_busy", message: "a command is already running" },
      }),
    ).toBe("pane_busy: a command is already running");
  });

  it("carries the reason herdr could not be reached", () => {
    expect(whyNot({ kind: "unreachable", message: "timed out" })).toBe(
      "timed out",
    );
  });

  it("says nothing about a success, which has no reason to give", () => {
    expect(whyNot({ kind: "ok", result: {} })).toBeUndefined();
  });
});
