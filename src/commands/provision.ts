import { readFile, stat } from "node:fs/promises";
import { createProbes } from "../lib/git/probes.js";
import { resolveRepo, type RepoCandidate } from "../lib/git/resolve.js";
import { loadConfig } from "../lib/config/load.js";
import { detectRepo, type FileProbe } from "../lib/config/detect.js";
import { generateConfig } from "../lib/config/generate.js";
import { provision, type ProvisionReport } from "../lib/provision/run.js";
import type { WtConfig } from "../lib/config/schema.js";
import type { Topology } from "../lib/git/topology.js";
import { gitFor } from "./ls.js";
import { selectWorktree } from "../lib/git/worktree.js";
import type { CommandContext } from "./context.js";

export type ProvisionInput = { repo?: string; branch: string };

export type ProvisionResult =
  | { kind: "ok"; report: ProvisionReport; worktreePath: string }
  | { kind: "planned"; worktreePath: string; steps: readonly string[] }
  | { kind: "choose"; from: string; candidates: readonly RepoCandidate[] }
  | { kind: "error"; message: string; hint?: string };

export const fileProbe: FileProbe = {
  exists: async (path) => {
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  },
  readJson: async (path): Promise<unknown> => {
    try {
      return JSON.parse(await readFile(path, "utf8")) as unknown;
    } catch {
      return null;
    }
  },
  isExecutable: async (path) => {
    try {
      return ((await stat(path)).mode & 0o111) !== 0;
    } catch {
      return false;
    }
  },
  measure: async (path) => {
    try {
      const info = await stat(path);
      if (!info.isDirectory()) return { entries: 1, bytes: info.size };
      const { readdir } = await import("node:fs/promises");
      const entries = await readdir(path, { recursive: true });
      return { entries: entries.length, bytes: info.size };
    } catch {
      return { entries: 0, bytes: 0 };
    }
  },
};

/** Config for a repo, generated from detection when there is none yet. */
export const configFor = async (
  topology: Topology,
  context: CommandContext,
): Promise<
  | {
      kind: "ok";
      config: WtConfig;
      generated?: string;
      warnings: readonly string[];
    }
  | { kind: "error"; message: string }
> => {
  const loaded = await loadConfig(
    context.env,
    topology.configRoot,
    topology.repoName,
  );
  if (loaded.kind === "error") {
    return { kind: "error", message: `${loaded.path}: ${loaded.message}` };
  }

  const warnings = loaded.loaded.warnings.map(
    (issue) => `${issue.path}: ${issue.message}`,
  );

  if (!loaded.loaded.needsInit) {
    return { kind: "ok", config: loaded.loaded.config, warnings };
  }

  const detected = await detectRepo(
    gitFor(context, topology.repoRoot),
    topology.repoRoot,
    fileProbe,
  );

  const generated = generateConfig({
    repoName: topology.repoName,
    detected,
    umbrella: topology.umbrella === "umbrella",
    devCommandInLayout: true,
  });

  return {
    kind: "ok",
    config: loaded.loaded.config,
    generated,
    warnings: [...warnings, ...detected.notes],
  };
};

export const runProvision = async (
  input: ProvisionInput,
  context: CommandContext,
): Promise<ProvisionResult> => {
  const git = gitFor(context, context.cwd);
  const resolution = await resolveRepo(
    { startDir: context.cwd, repoArg: input.repo },
    createProbes(git),
  );
  if (resolution.kind !== "ok") return resolution;

  const { topology } = resolution;
  const repoGit = gitFor(context, topology.repoRoot);
  const probes = createProbes(repoGit);

  const entries = (await probes.git.worktrees(topology.repoRoot)) ?? [];
  const selected = selectWorktree(entries, input.branch);
  if (selected.kind === "none") {
    return {
      kind: "error",
      message: `no worktree matches '${input.branch}'`,
      hint: "run `wt ls` to see what is there",
    };
  }
  if (selected.kind === "many") {
    return {
      kind: "error",
      message: `'${input.branch}' matches ${String(selected.paths.length)} worktrees`,
      hint: selected.paths.join(", "),
    };
  }
  const entry = selected.entry;

  const config = await configFor(topology, context);
  if (config.kind === "error") return config;

  if (context.dryRun) {
    return {
      kind: "planned",
      worktreePath: entry.path,
      steps: [
        ...config.config.provision.copy.map((path) => `copy ${path}`),
        ...config.config.provision.commands.map(
          (command) => `${command.run}   (${command.when})`,
        ),
      ],
    };
  }

  return {
    kind: "ok",
    worktreePath: entry.path,
    report: await provision(repoGit, {
      repoRoot: topology.repoRoot,
      worktreePath: entry.path,
      config: config.config,
      env: context.env,
      onProgress: context.trace,
    }),
  };
};
