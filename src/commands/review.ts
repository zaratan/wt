import { generateConfig } from "../lib/config/generate.js";
import { withGeneratedLayer } from "../lib/config/load.js";
import { applyDecision } from "../lib/config/review.js";
import { loadConfig } from "../lib/config/load.js";
import type { WtConfig } from "../lib/config/schema.js";
import type { Topology } from "../lib/git/topology.js";
import type { configFor } from "./provision.js";
import type { CommandContext } from "./context.js";

type Loaded = Extract<Awaited<ReturnType<typeof configFor>>, { kind: "ok" }>;

export type Reviewed =
  | {
      kind: "ok";
      config: WtConfig;
      /** Undefined means nothing is written: the user chose to go without. */
      generated?: string;
      warnings: readonly string[];
    }
  | { kind: "error"; message: string };

/**
 * Asked by the caller, never by `configFor`: `wt rm` loads the config after it
 * has already removed the worktree, and a review must not open there.
 */
export const reviewGenerated = async (
  loaded: Loaded,
  topology: Topology,
  context: CommandContext,
): Promise<Reviewed> => {
  const ask = context.reviewConfig;
  const detected = loaded.detected;
  if (
    ask === undefined ||
    detected === undefined ||
    loaded.generated === undefined
  ) {
    return {
      kind: "ok",
      config: loaded.config,
      generated: loaded.generated,
      warnings: loaded.warnings,
    };
  }

  const decision = await ask({
    repoName: topology.repoName,
    path: loaded.configPath,
    detected,
    umbrella: topology.umbrella,
    umbrellaReason: topology.umbrellaReason,
  });

  if (decision.kind === "skip") {
    return { kind: "ok", config: loaded.base, warnings: loaded.warnings };
  }

  const generated = generateConfig({
    repoName: topology.repoName,
    detected: applyDecision(detected, decision.copy),
    umbrella: topology.umbrella === "umbrella",
    devCommandInLayout: true,
  });

  const onDisk = await loadConfig(
    context.env,
    topology.configRoot,
    topology.repoName,
  );
  if (onDisk.kind === "error") {
    return { kind: "error", message: `${onDisk.path}: ${onDisk.message}` };
  }

  const folded = withGeneratedLayer(
    onDisk.loaded,
    generated,
    loaded.configPath,
  );
  if (folded.kind === "error") {
    return { kind: "error", message: `${folded.path}: ${folded.message}` };
  }

  return {
    kind: "ok",
    config: folded.loaded.config,
    generated,
    warnings: loaded.warnings,
  };
};
