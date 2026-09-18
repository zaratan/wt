import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { RemovePanel } from "./RemovePanel.js";
import { removalIntent, branchPlanFor } from "../../format/removal.js";
import { worktreeRows } from "../../format/rows.js";
import { DEFAULT_CONFIG } from "../../lib/config/schema.js";
import type { WorktreeStatus } from "../../lib/git/status.js";

const listed = (one: WorktreeStatus) => ({
  topology: { repoName: "app", repoRoot: "/p/app" },
  status: one,
});

const status = (overrides: Partial<WorktreeStatus> = {}): WorktreeStatus =>
  ({
    path: "/p/.worktrees/app-feat-x",
    branch: "feat/x",
    detached: false,
    isMain: false,
    managed: true,
    missing: false,
    prunable: false,
    modified: 0,
    untracked: 0,
    unpublished: { kind: "count", count: 0, sample: [] },
    ...overrides,
  }) as WorktreeStatus;

const rowOf = (overrides: Partial<WorktreeStatus> = {}) =>
  worktreeRows([listed(status(overrides))], {}, "/elsewhere")[0];

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 80));

describe("branchPlanFor", () => {
  it("only deletes when the config says always", () => {
    expect(branchPlanFor(DEFAULT_CONFIG)).toBe("kept");
    expect(
      branchPlanFor({
        ...DEFAULT_CONFIG,
        remove: { deleteBranch: "always" },
      }),
    ).toBe("deleted");
  });

  it("keeps the branch on ask, because the panel cannot stop to ask twice", () => {
    expect(
      branchPlanFor({ ...DEFAULT_CONFIG, remove: { deleteBranch: "ask" } }),
    ).toBe("kept");
  });
});

describe("RemovePanel", () => {
  it("says what will happen to the branch before anything is removed", () => {
    const row = rowOf();
    if (row === undefined) throw new Error("no row");
    const frame =
      render(
        <RemovePanel
          intent={removalIntent(row, [], {
            ...DEFAULT_CONFIG,
            remove: { deleteBranch: "always" },
          })}
          onAnswer={vi.fn()}
        />,
      ).lastFrame() ?? "";

    expect(frame).toContain("feat/x");
    expect(frame).toContain("deleted");
  });

  it("removes on enter when there is nothing to lose", async () => {
    const row = rowOf();
    if (row === undefined) throw new Error("no row");
    const onAnswer = vi.fn();
    const { stdin } = render(
      <RemovePanel
        intent={removalIntent(row, [], DEFAULT_CONFIG)}
        onAnswer={onAnswer}
      />,
    );

    stdin.write("\r");
    await settle();
    expect(onAnswer).toHaveBeenCalledWith(true);
  });

  it("does not bind enter at all when it is blocked", async () => {
    const row = rowOf({ modified: 2 });
    if (row === undefined) throw new Error("no row");
    const onAnswer = vi.fn();
    const { stdin, lastFrame } = render(
      <RemovePanel
        intent={removalIntent(row, ["2 uncommitted change(s)"], DEFAULT_CONFIG)}
        onAnswer={onAnswer}
      />,
    );

    stdin.write("\r");
    await settle();
    expect(onAnswer).not.toHaveBeenCalled();
    expect(lastFrame() ?? "").toContain("2 uncommitted change(s)");
  });

  it("prints the exact command to force, so the user leaves to do it", () => {
    const row = rowOf({ modified: 2 });
    if (row === undefined) throw new Error("no row");
    const frame =
      render(
        <RemovePanel
          intent={removalIntent(row, ["2 uncommitted"], DEFAULT_CONFIG)}
          onAnswer={vi.fn()}
        />,
      ).lastFrame() ?? "";
    expect(frame).toContain("wt rm feat/x --force");
  });

  it("cancels on escape", async () => {
    const row = rowOf();
    if (row === undefined) throw new Error("no row");
    const onAnswer = vi.fn();
    const { stdin } = render(
      <RemovePanel
        intent={removalIntent(row, [], DEFAULT_CONFIG)}
        onAnswer={onAnswer}
      />,
    );

    stdin.write("\x1b");
    await settle();
    expect(onAnswer).toHaveBeenCalledWith(false);
  });
});

describe("the main checkout", () => {
  it("is refused on the panel, before enter is even offered", () => {
    const row = worktreeRows(
      [listed(status({ isMain: true, path: "/p/app" }))],
      {},
      "/elsewhere",
    )[0];
    if (row === undefined) throw new Error("no row");

    const { lastFrame } = render(
      <RemovePanel
        intent={removalIntent(row, [], DEFAULT_CONFIG)}
        onAnswer={vi.fn()}
      />,
    );
    expect(lastFrame() ?? "").toContain("main checkout");
  });

  it("does not offer --force, which cannot lift that refusal", () => {
    const row = worktreeRows(
      [listed(status({ isMain: true, path: "/p/app" }))],
      {},
      "/elsewhere",
    )[0];
    if (row === undefined) throw new Error("no row");

    const { lastFrame } = render(
      <RemovePanel
        intent={removalIntent(row, [], DEFAULT_CONFIG)}
        onAnswer={vi.fn()}
      />,
    );
    expect(lastFrame() ?? "").not.toContain("--force");
  });

  it("does not remove on enter", async () => {
    const row = worktreeRows(
      [listed(status({ isMain: true, path: "/p/app" }))],
      {},
      "/elsewhere",
    )[0];
    if (row === undefined) throw new Error("no row");
    const onAnswer = vi.fn();

    const { stdin } = render(
      <RemovePanel
        intent={removalIntent(row, [], DEFAULT_CONFIG)}
        onAnswer={onAnswer}
      />,
    );
    stdin.write("\r");
    await settle();
    expect(onAnswer).not.toHaveBeenCalled();
  });
});
