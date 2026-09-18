import type { Git, GitOutcome } from "./exec.js";
import { okStdout } from "./exec.js";

export type BranchPlan =
  /** The branch exists locally and is free to check out. */
  | { kind: "checkout-local"; branch: string }
  /** It only exists upstream; check out tracking it. */
  | { kind: "track-remote"; branch: string; remote: string }
  /** It exists nowhere; create it from `base`. */
  | { kind: "create"; branch: string; base: string }
  /** Another worktree already holds it. */
  | { kind: "occupied"; branch: string; by: string };

export type BranchProblem = {
  kind: "error";
  message: string;
  hint?: string;
};

export type BranchResolution = BranchPlan | BranchProblem;

export type FetchReport =
  | { kind: "found" }
  | { kind: "absent" }
  | { kind: "unreachable"; message: string };

const ran = (
  outcome: GitOutcome,
): outcome is Extract<GitOutcome, { kind: "ran" }> => outcome.kind === "ran";

export const localBranchExists = async (
  git: Git,
  branch: string,
): Promise<boolean> => {
  const outcome = await git([
    "show-ref",
    "--verify",
    "--quiet",
    `refs/heads/${branch}`,
  ]);
  return ran(outcome) && outcome.code === 0;
};

export const remoteRefExists = async (
  git: Git,
  remote: string,
  branch: string,
): Promise<boolean> => {
  const outcome = await git([
    "rev-parse",
    "--verify",
    "--quiet",
    `refs/remotes/${remote}/${branch}`,
  ]);
  return ran(outcome) && outcome.code === 0;
};

/**
 * `git worktree list` tells us where, but this also answers for the main
 * checkout, which is the common case: `wt new <repo> develop` when develop is
 * already checked out there.
 */
export const branchHolder = async (
  git: Git,
  branch: string,
): Promise<string | undefined> => {
  const outcome = await git([
    "branch",
    "--format=%(refname:short)%09%(worktreepath)",
    "--list",
    branch,
  ]);
  const text = okStdout(outcome);
  if (text === undefined) return undefined;

  for (const line of text.split("\n")) {
    const [name, path] = line.split("\t");
    if (name === branch && path !== undefined && path !== "") return path;
  }
  return undefined;
};

export const listRemotes = async (git: Git): Promise<readonly string[]> => {
  const text = okStdout(await git(["remote"]));
  return text === undefined || text === ""
    ? []
    : text.split("\n").filter((line) => line !== "");
};

/**
 * A plain `git fetch <remote> <branch>` returns 0 on a single-branch clone
 * WITHOUT creating refs/remotes/<remote>/<branch>, so asking first and fetching
 * with an explicit refspec is what stops a divergent branch being created in
 * silence. `ls-remote --exit-code` answers 2 for "no such branch", which is the
 * ordinary case and must stay quiet.
 */
export const fetchBranch = async (
  git: Git,
  remote: string,
  branch: string,
): Promise<FetchReport> => {
  const probe = await git(
    ["ls-remote", "--exit-code", "--heads", remote, branch],
    { timeoutMs: 20_000 },
  );
  if (!ran(probe)) return { kind: "unreachable", message: probe.message };
  if (probe.code === 2) return { kind: "absent" };
  if (probe.code !== 0) {
    return { kind: "unreachable", message: probe.stderr.trim() };
  }

  const fetched = await git(
    [
      "fetch",
      "--quiet",
      remote,
      `+refs/heads/${branch}:refs/remotes/${remote}/${branch}`,
    ],
    { timeoutMs: 120_000 },
  );
  if (!ran(fetched) || fetched.code !== 0) {
    return {
      kind: "unreachable",
      message: ran(fetched) ? fetched.stderr.trim() : fetched.message,
    };
  }

  return (await remoteRefExists(git, remote, branch))
    ? { kind: "found" }
    : { kind: "absent" };
};

export const defaultBase = async (
  git: Git,
  remote: string | undefined,
): Promise<string | undefined> => {
  if (remote !== undefined) {
    const head = okStdout(
      await git(["symbolic-ref", "--quiet", `refs/remotes/${remote}/HEAD`]),
    );
    if (head !== undefined && head !== "") {
      return head.replace(/^refs\/remotes\//, "");
    }
  }
  const current = okStdout(await git(["rev-parse", "--abbrev-ref", "HEAD"]));
  return current === undefined || current === "HEAD" ? undefined : current;
};

export type ResolveBranchInput = {
  branch: string;
  /** From `--from`. Rejected when the branch already exists. */
  base?: string;
  remote?: string;
  fetch: boolean;
  onNotice?: (message: string) => void;
};

export const resolveBranch = async (
  git: Git,
  input: ResolveBranchInput,
): Promise<BranchResolution> => {
  const { branch, base, fetch, onNotice } = input;

  const holder = await branchHolder(git, branch);
  if (holder !== undefined) {
    return { kind: "occupied", branch, by: holder };
  }

  if (await localBranchExists(git, branch)) {
    if (base !== undefined) {
      return {
        kind: "error",
        message: `branch '${branch}' already exists, so --from ${base} cannot apply`,
        hint: "drop --from to check the existing branch out",
      };
    }
    return { kind: "checkout-local", branch };
  }

  const remotes = await listRemotes(git);
  const remote = input.remote ?? remotes[0];

  if (remote !== undefined) {
    if (await remoteRefExists(git, remote, branch)) {
      return { kind: "track-remote", branch, remote };
    }
    if (fetch) {
      const report = await fetchBranch(git, remote, branch);
      if (report.kind === "found") {
        return { kind: "track-remote", branch, remote };
      }
      if (report.kind === "unreachable") {
        onNotice?.(
          `could not reach ${remote} (${report.message}); creating '${branch}' locally, which may diverge from an existing upstream branch`,
        );
      }
    }
  }

  const resolvedBase = base ?? (await defaultBase(git, remote));
  if (resolvedBase === undefined) {
    return {
      kind: "error",
      message: `nothing to create '${branch}' from`,
      hint: "pass --from <ref>",
    };
  }
  return { kind: "create", branch, base: resolvedBase };
};
