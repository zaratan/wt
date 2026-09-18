import { createGit, okStdout } from "../lib/git/exec.js";
import { createProbes } from "../lib/git/probes.js";
import { detectTopology } from "../lib/git/topology.js";
import type { TopologyResult } from "../lib/git/topology.js";
import { preflight, type Pong } from "../lib/herdr/preflight.js";
import type { CommandContext } from "./context.js";

export type GitCheck =
  | { kind: "ok"; version: string }
  | { kind: "missing"; message: string };

export type HerdrCheck =
  | {
      kind: "ok";
      socketPath: string;
      version?: string;
      protocol?: number;
      capabilities: readonly string[];
    }
  | { kind: "down"; message: string; triedPaths: readonly string[] };

export type DoctorReport = {
  cwd: string;
  git: GitCheck;
  herdr: HerdrCheck;
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

const capabilityNames = (pong: Pong): readonly string[] =>
  Object.entries(pong.capabilities ?? {})
    .filter(([, value]) => value !== false)
    .map(([name]) => name)
    .sort();

const checkHerdr = async (context: CommandContext): Promise<HerdrCheck> => {
  const health = await preflight({
    env: context.env,
    cwd: context.cwd,
    trace: context.trace,
  });
  return health.kind === "ok"
    ? {
        kind: "ok",
        socketPath: health.socketPath,
        version: health.pong.version,
        protocol: health.pong.protocol,
        capabilities: capabilityNames(health.pong),
      }
    : { kind: "down", message: health.message, triedPaths: health.triedPaths };
};

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

  const herdr = await checkHerdr(context);

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
      herdr,
      inheritedGitVars,
    };
  }

  return {
    cwd: context.cwd,
    git: {
      kind: "ok",
      version: okStdout(versionOutcome)?.replace(/^git version /, "") ?? "?",
    },
    herdr,
    inheritedGitVars,
    topology: await detectTopology(
      { startDir: context.cwd },
      createProbes(git),
    ),
  };
};
