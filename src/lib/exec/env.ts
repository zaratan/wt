/**
 * Child-process environment construction.
 *
 * This is the one module allowed to read `process.env` (see eslint.config.js):
 * building a child's environment is its entire job.
 */

/**
 * Git reads these from the environment and they silently override `-C <path>`.
 *
 * The one that matters: with `GIT_DIR` exported, `git -C /a/main worktree list`
 * operates on the repo GIT_DIR points at, returns exit 0, and says nothing.
 * Hooks (`pre-commit`, `post-checkout`), `git rebase -x` and `git bisect run`
 * all export it — which is exactly how an agent invokes us.
 */
const INHERITED_GIT_VARS = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_COMMON_DIR",
  "GIT_INDEX_FILE",
  "GIT_PREFIX",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_CEILING_DIRECTORIES",
  "GIT_NAMESPACE",
] as const;

/**
 * Forced only for git itself, never for user commands: this machine's git
 * answers in French (`fatal : aucune branche amont configurée...`), so any
 * message-based classification would be dead on arrival. User-facing commands
 * keep the user's locale — pinning them to C would mangle their UTF-8 output.
 */
const GIT_LOCALE_OVERRIDES = {
  LC_ALL: "C",
  LANG: "C",
  LANGUAGE: "C",
  GIT_TERMINAL_PROMPT: "0",
  GIT_OPTIONAL_LOCKS: "0",
} as const;

export type EnvMap = Readonly<Record<string, string>>;

/**
 * Environment for any child process: inherited git state removed, caller
 * overrides applied. An override set to `undefined` unsets the variable.
 */
export const scrubEnv = (
  source: NodeJS.ProcessEnv,
  overrides: Readonly<Record<string, string | undefined>> = {},
): EnvMap => {
  const unset = new Set<string>(INHERITED_GIT_VARS);
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) unset.add(key);
  }

  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && !unset.has(key)) out[key] = value;
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
};

/** `scrubEnv` plus the locale and prompt pinning that only git needs. */
export const scrubGitEnv = (
  source: NodeJS.ProcessEnv,
  overrides: Readonly<Record<string, string | undefined>> = {},
): EnvMap => scrubEnv(source, { ...GIT_LOCALE_OVERRIDES, ...overrides });

/** The process environment, captured once at startup by `src/index.tsx`. */
export const readProcessEnv = (): NodeJS.ProcessEnv => process.env;
