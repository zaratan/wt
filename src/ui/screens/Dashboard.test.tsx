import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { Dashboard } from "./Dashboard.js";
import { worktreeRows } from "../../format/rows.js";
import type { WorktreeStatus } from "../../lib/git/status.js";

const listed = (one: WorktreeStatus) => ({
  topology: { repoName: "app", repoRoot: "/p/app" },
  status: one,
});

const status = (overrides: Partial<WorktreeStatus> = {}): WorktreeStatus =>
  ({
    path: "/p/app",
    branch: "develop",
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

const rows = worktreeRows(
  [
    listed(status({ path: "/p/app", isMain: true })),
    listed(
      status({
        path: "/p/.worktrees/app-cmdb",
        branch: "feat/cmdb",
        unpublished: { kind: "count", count: 3, sample: [] },
      }),
    ),
    listed(
      status({
        path: "/p/.worktrees/app-old",
        branch: "feat/old",
        missing: true,
      }),
    ),
  ],
  {},
  "/elsewhere",
);

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 80));

const base = {
  repoName: "app",
  rows,
  orphans: [],
  focused: 0,
  onFocus: vi.fn(),
  onAct: vi.fn(),
};

describe("Dashboard", () => {
  it("gives a clean row no glyph, so the eye lands only on trouble", () => {
    const frame = render(<Dashboard {...base} />).lastFrame() ?? "";
    expect(frame).toContain("• ");
    expect(frame).toContain("✗ ");
    expect(frame).not.toContain("· app");
  });

  it("shows unpublished commits, which is a reason d can refuse", () => {
    expect(render(<Dashboard {...base} />).lastFrame() ?? "").toContain(
      "3 unpublished",
    );
  });

  it("says herdr is unreachable rather than showing an empty space column", () => {
    const frame =
      render(
        <Dashboard {...base} herdrUnavailable="socket is gone" />,
      ).lastFrame() ?? "";
    expect(frame).toContain("herdr unreachable");
    expect(frame).toContain("socket is gone");
  });

  it("asks to remove the row under the cursor, not the first one", async () => {
    const onAct = vi.fn();
    const { stdin } = render(<Dashboard {...base} focused={2} onAct={onAct} />);

    stdin.write("d");
    await settle();
    expect(onAct).toHaveBeenCalledWith("remove", rows[2]);
  });

  it("ignores every key while an action is running", async () => {
    const onAct = vi.fn();
    const { stdin } = render(
      <Dashboard {...base} busy="removing" onAct={onAct} />,
    );

    stdin.write("d");
    await settle();
    stdin.write("\r");
    await settle();
    expect(onAct).not.toHaveBeenCalled();
  });

  it("offers no key at all while busy", () => {
    const frame =
      render(<Dashboard {...base} busy="removing" />).lastFrame() ?? "";
    expect(frame).not.toContain("d remove");
    expect(frame).toContain("removing…");
  });

  it("wraps the cursor from the first row to the last", async () => {
    const onFocus = vi.fn();
    const { stdin } = render(<Dashboard {...base} onFocus={onFocus} />);

    stdin.write("\x1b[A");
    await settle();
    expect(onFocus).toHaveBeenCalledWith(2);
  });
});
