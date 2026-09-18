import { describe, it, expect } from "vitest";
import { rowNotes, rowSeverity, worktreeRows, spaceNote } from "./rows.js";
import type { WorktreeStatus } from "../lib/git/status.js";

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

describe("rowNotes", () => {
  it("names every condition wt rm can refuse for", () => {
    const notes = rowNotes(
      status({
        modified: 2,
        untracked: 1,
        unpublished: { kind: "count", count: 3, sample: [] },
        operation: "rebase",
      } as Partial<WorktreeStatus>),
    );
    expect(notes.join(" ")).toContain("rebase in progress");
    expect(notes.join(" ")).toContain("2 modified");
    expect(notes.join(" ")).toContain("1 untracked");
    expect(notes.join(" ")).toContain("3 unpublished");
  });

  it("says never published when there is no remote at all", () => {
    expect(
      rowNotes(status({ unpublished: { kind: "no-remote", count: 4 } })).join(
        " ",
      ),
    ).toContain("never published");
  });
});

describe("rowSeverity", () => {
  it("calls a worktree with nothing to report clean", () => {
    expect(rowSeverity(status())).toBe("clean");
  });

  it("separates a worktree that is gone from one that merely has notes", () => {
    expect(rowSeverity(status({ modified: 1 }))).toBe("notes");
    expect(rowSeverity(status({ missing: true }))).toBe("gone");
    expect(rowSeverity(status({ prunable: true }))).toBe("gone");
  });
});

describe("worktreeRows", () => {
  it("marks the worktree the command was run from", () => {
    const rows = worktreeRows(
      [status(), status({ path: "/p/other" })],
      {},
      "/p/.worktrees/app-feat-x/apps/web",
    );
    expect(rows[0]?.here).toBe(true);
    expect(rows[1]?.here).toBe(false);
  });

  it("does not mistake a sibling whose path merely starts the same", () => {
    const rows = worktreeRows([status()], {}, "/p/.worktrees/app-feat-x-other");
    expect(rows[0]?.here).toBe(false);
  });
});

describe("spaceNote", () => {
  it("separates a focused space from one that is merely open", () => {
    expect(spaceNote({ focused: true, label: "CMDB" })).toContain("focused");
    expect(spaceNote({ focused: false, label: "CMDB" })).toContain(
      "space open",
    );
  });

  it("says nothing when herdr reported no space", () => {
    expect(spaceNote(undefined)).toBeUndefined();
  });
});
