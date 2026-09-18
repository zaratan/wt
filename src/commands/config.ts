import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createProbes } from "../lib/git/probes.js";
import { resolveRepo, type RepoCandidate } from "../lib/git/resolve.js";
import { configPaths, loadConfig } from "../lib/config/load.js";
import type { WtConfig } from "../lib/config/schema.js";
import { gitFor } from "./ls.js";
import { umbrellaAsker } from "./umbrella.js";
import { configFor } from "./provision.js";
import type { CommandContext } from "./context.js";

export type ConfigAction = "init" | "show" | "path" | "edit";

export type ConfigResult =
  | { kind: "paths"; paths: readonly string[]; active?: string }
  | {
      kind: "shown";
      config: WtConfig;
      sources: readonly string[];
      warnings: readonly string[];
    }
  | { kind: "written"; path: string }
  | { kind: "edit"; path: string }
  | { kind: "choose"; from: string; candidates: readonly RepoCandidate[] }
  | { kind: "error"; message: string; hint?: string };

export const writeGenerated = async (
  configRoot: string,
  repoName: string,
  contents: string,
): Promise<string> => {
  const directory = join(configRoot, ".wt");
  const file = join(directory, `${repoName}.toml`);
  await mkdir(directory, { recursive: true });
  await writeFile(`${file}.tmp`, contents);
  await rename(`${file}.tmp`, file);
  return file;
};

export const runConfig = async (
  action: ConfigAction,
  repoArg: string | undefined,
  context: CommandContext,
): Promise<ConfigResult> => {
  const git = gitFor(context, context.cwd);
  // `show` and `path` must not question the user, nor create `.wt/` as a side
  // effect of being asked where a file would live.
  const writes = action === "init";
  const resolution = await resolveRepo(
    {
      startDir: context.cwd,
      repoArg,
      askUmbrella: writes ? umbrellaAsker(context) : undefined,
      chooseRepo: context.chooseRepo,
    },
    createProbes(git),
  );
  if (resolution.kind !== "ok") return resolution;

  const { topology } = resolution;
  const paths = configPaths(
    context.env,
    topology.configRoot,
    topology.repoName,
  );

  if (action === "path" || action === "edit") {
    const loaded = await loadConfig(
      context.env,
      topology.configRoot,
      topology.repoName,
    );
    const active =
      loaded.kind === "ok" ? loaded.loaded.sources.at(-1) : undefined;
    return action === "path"
      ? {
          kind: "paths",
          paths: [paths.global, paths.defaults, paths.repo],
          active,
        }
      : { kind: "edit", path: active ?? paths.repo };
  }

  if (action === "init") {
    const detected = await configFor(topology, context);
    if (detected.kind === "error") return detected;
    if (detected.generated === undefined) {
      return {
        kind: "error",
        message: `${paths.repo} already exists`,
        hint: "edit it, or delete it to regenerate",
      };
    }
    return {
      kind: "written",
      path: await writeGenerated(
        topology.configRoot,
        topology.repoName,
        detected.generated,
      ),
    };
  }

  const loaded = await loadConfig(
    context.env,
    topology.configRoot,
    topology.repoName,
  );
  if (loaded.kind === "error") {
    return { kind: "error", message: `${loaded.path}: ${loaded.message}` };
  }
  return {
    kind: "shown",
    config: loaded.loaded.config,
    sources: loaded.loaded.sources,
    warnings: loaded.loaded.warnings.map(
      (issue) => `${issue.path}: ${issue.message}`,
    ),
  };
};
