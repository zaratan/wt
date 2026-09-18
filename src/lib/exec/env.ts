/**
 * With GIT_DIR exported, `git -C /a worktree list` operates on the repo GIT_DIR
 * names, returns 0, and says nothing. Hooks and `git rebase -x` export it.
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
 * git answers in the machine's locale, so message matching needs C. Only git:
 * pinning user commands to C would mangle their UTF-8 output.
 */
const GIT_LOCALE_OVERRIDES = {
  LC_ALL: "C",
  LANG: "C",
  LANGUAGE: "C",
  GIT_TERMINAL_PROMPT: "0",
  GIT_OPTIONAL_LOCKS: "0",
} as const;

export type EnvMap = Readonly<Record<string, string>>;

/** An override set to `undefined` unsets the variable. */
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

export const scrubGitEnv = (
  source: NodeJS.ProcessEnv,
  overrides: Readonly<Record<string, string | undefined>> = {},
): EnvMap => scrubEnv(source, { ...GIT_LOCALE_OVERRIDES, ...overrides });

export const readProcessEnv = (): NodeJS.ProcessEnv => process.env;
