import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import {
  DEFAULT_CONFIG,
  mergeConfigs,
  validateConfig,
  type ConfigIssue,
  type WtConfig,
} from "./schema.js";

export const CONFIG_DIR = ".wt";

export type ConfigPaths = {
  /** `~/.config/wt/config.toml` */
  global: string;
  /** `<configRoot>/.wt/defaults.toml` */
  defaults: string;
  /** `<configRoot>/.wt/<repoName>.toml` */
  repo: string;
};

export const configPaths = (
  env: NodeJS.ProcessEnv,
  configRoot: string,
  repoName: string,
): ConfigPaths => {
  const home = env.HOME ?? "";
  const xdg = env.XDG_CONFIG_HOME;
  const base = xdg === undefined || xdg === "" ? join(home, ".config") : xdg;
  return {
    global: join(base, "wt", "config.toml"),
    defaults: join(configRoot, CONFIG_DIR, "defaults.toml"),
    repo: join(configRoot, CONFIG_DIR, `${repoName}.toml`),
  };
};

export type LoadedConfig = {
  config: WtConfig;
  /** Files that actually contributed, in precedence order. */
  sources: readonly string[];
  warnings: readonly ConfigIssue[];
  /** True when no `.wt/<repo>.toml` exists yet. */
  needsInit: boolean;
};

export type LoadResult =
  | { kind: "ok"; loaded: LoadedConfig }
  | { kind: "error"; message: string; path: string };

const readLayer = async (
  path: string,
): Promise<
  | { kind: "missing" }
  | { kind: "ok"; raw: unknown }
  | { kind: "error"; message: string }
> => {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return { kind: "missing" };
  }
  try {
    return { kind: "ok", raw: parseToml(text) };
  } catch (error) {
    return {
      kind: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
};

export const loadConfig = async (
  env: NodeJS.ProcessEnv,
  configRoot: string,
  repoName: string,
): Promise<LoadResult> => {
  const paths = configPaths(env, configRoot, repoName);
  const order = [paths.global, paths.defaults, paths.repo];

  const layers: Partial<WtConfig>[] = [];
  const sources: string[] = [];
  const warnings: ConfigIssue[] = [];
  let repoLayerFound = false;

  for (const path of order) {
    const read = await readLayer(path);
    if (read.kind === "missing") continue;
    if (read.kind === "error") {
      return { kind: "error", message: read.message, path };
    }

    const validated = validateConfig(read.raw, path);
    if (validated.kind === "too-new") {
      return {
        kind: "error",
        message: `written for schema ${String(validated.found)}, but this wt understands 1 — upgrade wt`,
        path,
      };
    }

    layers.push(validated.parsed.config);
    warnings.push(...validated.parsed.warnings);
    sources.push(path);
    if (path === paths.repo) repoLayerFound = true;
  }

  return {
    kind: "ok",
    loaded: {
      config: mergeConfigs([DEFAULT_CONFIG, ...layers]),
      sources,
      warnings,
      needsInit: !repoLayerFound,
    },
  };
};
