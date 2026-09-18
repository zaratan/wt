import { basename } from "node:path";
import { lines, okStdout, type Git } from "../git/exec.js";
import { preferredRemote } from "../git/branch.js";

export type CopyCandidate = {
  path: string;
  reason: string;
  /** Proposed commented out: too big to copy blindly. */
  held?: string;
};

export type Detected = {
  packageManager?: string;
  installCommand?: string;
  devCommand?: string;
  defaultBase?: string;
  remote?: string;
  copy: readonly CopyCandidate[];
  notes: readonly string[];
};

export type FileProbe = {
  exists: (path: string) => Promise<boolean>;
  readJson: (path: string) => Promise<unknown>;
  isExecutable: (path: string) => Promise<boolean>;
  /** Entry count and byte size, for the "too big to copy" guard. */
  measure: (path: string) => Promise<{ entries: number; bytes: number }>;
};

const LOCKFILES: readonly (readonly [string, string])[] = [
  ["pnpm-lock.yaml", "pnpm"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["yarn.lock", "yarn"],
  ["package-lock.json", "npm"],
  ["Gemfile.lock", "bundle"],
  ["Cargo.lock", "cargo"],
  ["uv.lock", "uv"],
  ["poetry.lock", "poetry"],
  ["go.sum", "go"],
  ["mix.lock", "mix"],
];

const INSTALL_FOR: Record<string, string> = {
  pnpm: "pnpm install",
  bun: "bun install",
  yarn: "yarn install",
  npm: "npm install",
  bundle: "bundle install",
  cargo: "cargo fetch",
  uv: "uv sync",
  poetry: "poetry install",
  go: "go mod download",
  mix: "mix deps.get",
};

/** Rejected before anything else: none of this is worth copying, ever. */
const DENY = [
  "node_modules",
  ".next",
  ".turbo",
  ".nuxt",
  "dist",
  "build",
  "coverage",
  "tmp",
  "log",
  "logs",
  "storage",
  "vendor",
  "target",
  ".venv",
  "__pycache__",
  ".DS_Store",
  ".direnv",
  ".husky/_",
];

const SECRET_PATTERNS: readonly (readonly [RegExp, string])[] = [
  [/(^|\/)\.env$/, "ignored, and the repo expects it"],
  [/(^|\/)\.env\.[^/]+$/, "ignored environment file"],
  [/(^|\/)\.envrc$/, "direnv configuration"],
  [/\.(key|pem|p12|pfx)$/, "key material"],
  [/(^|\/)certificates?(\/|$)/, "local certificates"],
  [/(^|\/)credentials(\/|$)/, "credentials"],
  [/(^|\/)master\.key$/, "Rails master key"],
];

const EXAMPLE = /\.(example|sample|template|dist)$/;

/** Above either bound, the entry is proposed commented out. */
export const MAX_COPY_ENTRIES = 200;
export const MAX_COPY_BYTES = 10 * 1024 * 1024;

const denied = (path: string): boolean =>
  DENY.some(
    (entry) =>
      path === entry ||
      path.startsWith(`${entry}/`) ||
      path.includes(`/${entry}/`) ||
      path.endsWith(`/${entry}`),
  );

export const classifyIgnored = async (
  path: string,
  probe: FileProbe,
  absolute: string,
): Promise<CopyCandidate | undefined> => {
  const clean = path.replace(/\/$/, "");
  if (denied(clean) || EXAMPLE.test(clean)) return undefined;

  const matched = SECRET_PATTERNS.find(([pattern]) => pattern.test(clean));
  if (matched === undefined) return undefined;

  const size = await probe.measure(absolute);
  if (size.entries > MAX_COPY_ENTRIES || size.bytes > MAX_COPY_BYTES) {
    return {
      path: clean,
      reason: matched[1],
      held: `${String(size.entries)} entries, ${String(Math.round(size.bytes / 1024))} KiB`,
    };
  }
  return { path: clean, reason: matched[1] };
};

export const detectRepo = async (
  git: Git,
  repoRoot: string,
  probe: FileProbe,
): Promise<Detected> => {
  const notes: string[] = [];
  const at = (relative: string): string => `${repoRoot}/${relative}`;

  const packageJson = (await probe.exists(at("package.json")))
    ? ((await probe.readJson(at("package.json"))) as {
        packageManager?: unknown;
        scripts?: Record<string, unknown>;
      } | null)
    : null;

  let packageManager: string | undefined;
  const declared = packageJson?.packageManager;
  if (typeof declared === "string") {
    packageManager = declared.split("@")[0] ?? undefined;
  } else {
    for (const [file, manager] of LOCKFILES) {
      if (await probe.exists(at(file))) {
        packageManager = manager;
        break;
      }
    }
  }

  // A tracked, executable bin/setup is the project's own answer to "get this
  // checkout ready", and it usually does more than install.
  const setupTracked = await git(["ls-files", "--error-unmatch", "bin/setup"], {
    cwd: repoRoot,
  });
  const hasSetup =
    setupTracked.kind === "ran" &&
    setupTracked.code === 0 &&
    (await probe.isExecutable(at("bin/setup")));

  const installCommand = hasSetup
    ? "bin/setup"
    : packageManager === undefined
      ? undefined
      : INSTALL_FOR[packageManager];

  let devCommand: string | undefined;
  if (await probe.exists(at("bin/dev"))) devCommand = "bin/dev";
  else if (
    typeof packageJson?.scripts?.dev === "string" &&
    packageManager !== undefined
  ) {
    devCommand = `${packageManager} dev`;
  } else if (await probe.exists(at("Procfile.dev"))) {
    devCommand = "overmind start -f Procfile.dev";
  }

  const remote = preferredRemote(
    lines(okStdout(await git(["remote"], { cwd: repoRoot })) ?? ""),
  );

  const head =
    remote === undefined
      ? undefined
      : okStdout(
          await git(
            ["symbolic-ref", "--quiet", `refs/remotes/${remote}/HEAD`],
            {
              cwd: repoRoot,
            },
          ),
        );
  const defaultBase =
    head !== undefined && head !== ""
      ? head.replace(/^refs\/remotes\//, "")
      : okStdout(
          await git(["rev-parse", "--abbrev-ref", "HEAD"], { cwd: repoRoot }),
        );

  const ignored = okStdout(
    await git(["status", "--porcelain", "--ignored"], { cwd: repoRoot }),
  );

  const copy: CopyCandidate[] = [];
  for (const line of lines(ignored ?? "")) {
    if (!line.startsWith("!!")) continue;
    const path = line.slice(3).replace(/^"|"$/g, "");
    const candidate = await classifyIgnored(path, probe, at(path));
    if (candidate !== undefined) copy.push(candidate);
  }

  // A tracked .env.example with no .env anywhere means the checkout will start
  // half-configured, and nothing else would say so.
  const exampleTracked = await git(
    ["ls-files", "--error-unmatch", ".env.example"],
    { cwd: repoRoot },
  );
  if (
    exampleTracked.kind === "ran" &&
    exampleTracked.code === 0 &&
    !copy.some((entry) => basename(entry.path) === ".env")
  ) {
    notes.push(
      ".env.example is tracked but no .env was found — the repo expects one",
    );
  }

  return {
    packageManager,
    installCommand,
    devCommand,
    defaultBase: defaultBase === "HEAD" ? undefined : defaultBase,
    remote,
    copy,
    notes,
  };
};
