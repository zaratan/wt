/**
 * What a command is handed instead of reading the world itself.
 *
 * `index.tsx` builds this once. Nothing below it touches `process.cwd()` or
 * `process.env` — that is what makes `--cwd` honest and every command testable.
 */
import type { OptionValues } from "../cli/parse.js";

export type CommandContext = {
  /** Already resolved from `--cwd` when given. */
  cwd: string;
  env: NodeJS.ProcessEnv;
  options: OptionValues;
  json: boolean;
  yes: boolean;
  verbose: boolean;
  dryRun: boolean;
  /** True when stdout is a terminal: gates prompts, colour and focus stealing. */
  interactive: boolean;
  /** Where `--verbose` traces go. Undefined when not tracing. */
  trace?: (line: string) => void;
};
