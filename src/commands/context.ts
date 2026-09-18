import type { OptionValues } from "../cli/parse.js";
import type { ChooseRepo } from "../lib/git/resolve.js";
import type { ReviewConfig } from "../lib/config/review.js";
import type { ProvisionEvent } from "../lib/provision/run.js";

export type ProgressTitle = {
  repoName: string;
  branch: string;
  steps: readonly string[];
  logPath?: string;
};

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
  reviewConfig?: ReviewConfig;
  /** Wraps a long run in a live screen, when there is one to draw on. */
  withProgress?: <T>(
    title: ProgressTitle,
    work: (emit: (event: ProvisionEvent) => void) => Promise<T>,
  ) => Promise<T>;
  /** This process, recorded in the provisioning lock so a dead one is cleared. */
  pid: number;
  trace?: (line: string) => void;
};
