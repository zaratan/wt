import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { CONFIG_DIR, type UmbrellaAsk } from "../lib/git/topology.js";
import { umbrellaQuestion } from "../format/umbrella.js";
import type { CommandContext } from "./context.js";

/**
 * The answer is remembered by creating `.wt/` where it points, which is the
 * same marker `declared-parent` and `declared-repo` already read.
 */
export const umbrellaAsker = (
  context: CommandContext,
): UmbrellaAsk | undefined => {
  const confirm = context.confirm;
  if (confirm === undefined || context.dryRun) return undefined;
  return async ({ parent, repoRoot }) => {
    const answer = await confirm(umbrellaQuestion(parent, repoRoot));
    try {
      await mkdir(join(answer ? parent : repoRoot, CONFIG_DIR), {
        recursive: true,
      });
    } catch {
      // A read-only parent still gets the answer it was asked for; it will
      // simply be asked again next time.
    }
    return answer;
  };
};
