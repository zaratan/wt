import { describe, it, expect } from "vitest";
import { spaceIsReady } from "./space.js";
import type { SpaceOutcome } from "./space.js";

const opened = (
  steps: readonly { step: string; ok: boolean }[],
): SpaceOutcome =>
  ({
    kind: "opened",
    result: {
      alreadyOpen: false,
      paneIds: new Map(),
      deferred: [],
      steps,
    },
  }) as unknown as SpaceOutcome;

describe("spaceIsReady", () => {
  it("is false when the layout was refused, although the space opened", () => {
    expect(
      spaceIsReady(
        opened([
          { step: "worktree.open", ok: true },
          { step: "layout.apply", ok: false },
        ]),
      ),
    ).toBe(false);
  });

  it("ignores a failed focus, which costs the user nothing", () => {
    expect(
      spaceIsReady(
        opened([
          { step: "worktree.open", ok: true },
          { step: "layout.apply", ok: true },
          { step: "workspace.focus", ok: false },
        ]),
      ),
    ).toBe(true);
  });

  it("is false when herdr could not be reached at all", () => {
    expect(
      spaceIsReady({ kind: "unavailable", message: "down", manual: [] }),
    ).toBe(false);
  });

  it("is true when no space was asked for", () => {
    expect(spaceIsReady(undefined)).toBe(true);
  });
});
