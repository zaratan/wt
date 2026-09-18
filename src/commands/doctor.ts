/**
 * `wt doctor` — what wt sees from here.
 *
 * This is the first thing to run when something behaves oddly, so it reports
 * the two inputs that make the rest lie when they are wrong: an inherited
 * GIT_DIR, and whatever git resolved the main checkout to.
 */
import { createGit, okStdout } from "../lib/git/exec.js";
import { createProbes } from "../lib/git/probes.js";
import { detectTopology } from "../lib/git/topology.js";
import type { TopologyResult } from "../lib/git/topology.js";
import type { CommandContext } from "./context.js";

export type GitCheck =
  | { kind: "ok"; version: string }
  | { kind: "missing"; message: string };

export type DoctorReport = {
  cwd: string;
  git: GitCheck;
  /** Git variables found in the ambient environment, which wt strips. */
  inheritedGitVars: readonly string[];
  topology?: TopologyResult;
};

const WATCHED_GIT_VARS = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_COMMON_DIR",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
] as const;

export const doctor = async (
  context: CommandContext,
): Promise<DoctorReport> => {
  const git = createGit({
    cwd: context.cwd,
    env: context.env,
    trace:
      context.trace === undefined
        ? undefined
        : (args, cwd) => {
            context.trace?.(`+ git ${args.join(" ")}  (in ${cwd})`);
          },
  });

  const inheritedGitVars = WATCHED_GIT_VARS.filter(
    (name) => context.env[name] !== undefined,
  );

  const versionOutcome = await git(["--version"]);
  if (versionOutcome.kind !== "ran" || versionOutcome.code !== 0) {
    return {
      cwd: context.cwd,
      git: {
        kind: "missing",
        message:
          versionOutcome.kind === "unavailable"
            ? versionOutcome.message
            : versionOutcome.stderr.trim(),
      },
      inheritedGitVars,
    };
  }

  return {
    cwd: context.cwd,
    git: {
      kind: "ok",
      version: okStdout(versionOutcome)?.replace(/^git version /, "") ?? "?",
    },
    inheritedGitVars,
    topology: await detectTopology(
      { startDir: context.cwd },
      createProbes(git),
    ),
  };
};
