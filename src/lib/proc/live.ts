import { run } from "../exec/run.js";
import { scrubEnv } from "../exec/env.js";

export type LiveProcess = { pid: string; command: string };

const LSOF_TIMEOUT_MS = 3_000;

// lsof lives in /usr/sbin on macOS and /usr/bin on most Linux distributions.
// Resolving it by PATH alone would make the guard vanish silently whenever
// /usr/sbin is absent from it, which is the failure a guard must not have.
const LSOF_PATHS = ["/usr/sbin/lsof", "/usr/bin/lsof", "lsof"] as const;

// An idle shell is what a herdr pane looks like when nothing is running in it,
// and there is one in every pane. Blocking on those would make the guard fire
// on every removal; what matters is a command that writes files.
const IDLE_SHELLS = new Set(["zsh", "bash", "sh", "fish", "dash", "login"]);

const withinTree = (root: string, path: string): boolean =>
  path === root || path.startsWith(`${root}/`);

/**
 * Processes whose working directory sits inside the tree. This is the guard
 * that stops `wt rm` racing a dev server: git deletes the files, the server
 * recreates them, and the removal ends half done.
 *
 * lsof without privileges reports only this user's processes, which is exactly
 * the scope wanted. No lsof, or any failure, means "nothing found": a missing
 * tool must not block a removal.
 */
export const processesIn = async (
  root: string,
  env: NodeJS.ProcessEnv,
): Promise<readonly LiveProcess[]> => {
  let stdout: string | undefined;
  for (const lsof of LSOF_PATHS) {
    const result = await run({
      argv: [lsof, "-d", "cwd", "-F", "pcn"],
      cwd: "/",
      env: scrubEnv(env),
      timeoutMs: LSOF_TIMEOUT_MS,
    });
    // lsof exits non-zero when some processes cannot be inspected, which is
    // normal without privileges: judge it on having produced output.
    if (result.kind === "ok" && result.outcome.stdout.includes("\np")) {
      stdout = result.outcome.stdout;
      break;
    }
  }
  if (stdout === undefined) return [];

  const found: LiveProcess[] = [];
  let pid = "";
  let command = "";
  for (const line of stdout.split("\n")) {
    const value = line.slice(1);
    switch (line[0]) {
      case "p":
        pid = value;
        break;
      case "c":
        command = value;
        break;
      case "n":
        if (withinTree(root, value) && !IDLE_SHELLS.has(command)) {
          found.push({ pid, command });
        }
        break;
      default:
        break;
    }
  }
  return found;
};

export const describeProcesses = (
  processes: readonly LiveProcess[],
): string | undefined => {
  if (processes.length === 0) return undefined;
  const names = [...new Set(processes.map((entry) => entry.command))]
    .slice(0, 3)
    .join(", ");
  return `${String(processes.length)} process(es) still running in it (${names})`;
};
