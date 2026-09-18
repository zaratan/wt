import type { OptionValues } from "../cli/parse.js";
import type { ChooseRepo } from "../lib/git/resolve.js";

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
  /** Aborted on SIGINT, so a killed command still gets to record its state. */
  signal?: AbortSignal;
  /** Present only when a screen can be shown: absent leaves the `choose` result. */
  chooseRepo?: ChooseRepo;
  /** This process, recorded in the provisioning lock so a dead one is cleared. */
  pid: number;
  trace?: (line: string) => void;
};
