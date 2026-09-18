import type { OptionValues } from "../cli/parse.js";

export type CommandContext = {
  cwd: string;
  env: NodeJS.ProcessEnv;
  options: OptionValues;
  json: boolean;
  yes: boolean;
  verbose: boolean;
  dryRun: boolean;
  interactive: boolean;
  /** Present only on a terminal that may be questioned: absent means "no". */
  confirm?: (question: string) => Promise<boolean>;
  trace?: (line: string) => void;
};
