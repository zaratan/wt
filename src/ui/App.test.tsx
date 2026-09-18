import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "ink-testing-library";
import type { CommandContext } from "../commands/context.js";
import type { WorktreeStatus } from "../lib/git/status.js";

type Call = (input: unknown, context: unknown) => Promise<unknown>;

const runRm = vi.fn();
const runLs = vi.fn();
const runOpen = vi.fn();

const forward =
  (spy: typeof runRm): Call =>
  (input, context) =>
    spy(input, context) as Promise<unknown>;

vi.mock("../commands/rm.js", async () => {
  const actual = await vi.importActual<object>("../commands/rm.js");
  return {
    ...actual,
    runRm: forward(runRm),
  };
});
vi.mock("../commands/ls.js", async () => {
  const actual = await vi.importActual<object>("../commands/ls.js");
  return {
    ...actual,
    runLs: forward(runLs),
  };
});
vi.mock("../commands/open.js", () => ({
  runOpen: forward(runOpen),
}));
vi.mock("../commands/provision.js", () => ({
  configFor: () => Promise.resolve({ kind: "error", message: "none" }),
}));

const { App } = await import("./App.js");

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

const base = {
  cwd: "/elsewhere",
  env: {},
  options: {},
  json: false,
  yes: false,
  verbose: false,
  dryRun: false,
  interactive: true,
  pid: 1,
  confirm: vi.fn(),
  signal: new AbortController().signal,
} as unknown as CommandContext;

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 120));

const listing = (worktrees: readonly WorktreeStatus[]) => ({
  kind: "ok" as const,
  report: {
    topology: { repoName: "app" },
    worktrees,
    orphans: [],
    spaces: {},
    pruned: false,
  },
});

beforeEach(() => {
  runRm.mockReset();
  runLs.mockReset();
  runOpen.mockReset();
  runRm.mockResolvedValue({ kind: "removed" });
});

describe("the dashboard's removal", () => {
  it("never hands runRm a context that could reach for stdin", async () => {
    runLs.mockResolvedValue(listing([status()]));
    const { stdin } = render(<App base={base} onLeave={vi.fn()} />);
    await settle();

    stdin.write("d");
    await settle();
    stdin.write("\r");
    await settle();

    expect(runRm).toHaveBeenCalledOnce();
    const [input, context] = runRm.mock.calls[0] as [
      Record<string, unknown>,
      CommandContext,
    ];
    expect(input.force).toBe(false);
    expect(typeof input.deleteBranch).toBe("boolean");
    expect(context.confirm).toBeUndefined();
    expect(context.withProgress).toBeUndefined();
  });

  it("runs once when the key repeats in the same tick", async () => {
    runLs.mockResolvedValue(listing([status()]));
    const { stdin } = render(<App base={base} onLeave={vi.fn()} />);
    await settle();

    stdin.write("d");
    await settle();
    stdin.write("\r");
    stdin.write("\r");
    await settle();

    expect(runRm).toHaveBeenCalledOnce();
  });

  it("refuses without calling runRm when the worktree holds work", async () => {
    runLs.mockResolvedValue(listing([status({ modified: 2 })]));
    const { stdin, lastFrame } = render(<App base={base} onLeave={vi.fn()} />);
    await settle();

    stdin.write("d");
    await settle();
    stdin.write("\r");
    await settle();

    expect(runRm).not.toHaveBeenCalled();
    expect(lastFrame() ?? "").toContain("not ready to be removed");
  });

  it("re-reads the list afterwards and clamps the cursor", async () => {
    runLs
      .mockResolvedValueOnce(listing([status(), status({ path: "/p/two" })]))
      .mockResolvedValue(listing([status()]));

    const { stdin, lastFrame } = render(<App base={base} onLeave={vi.fn()} />);
    await settle();

    stdin.write("\x1b[B");
    await settle();
    stdin.write("d");
    await settle();
    stdin.write("\r");
    await settle();

    expect(runLs).toHaveBeenCalledTimes(2);
    expect(lastFrame() ?? "").not.toContain("/p/two");
  });
});
