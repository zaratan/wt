/**
 * Where am I, which repository is this, and where do its worktrees go.
 *
 * Pure over injected probes, so every disposition (bare repo, linked worktree,
 * submodule, umbrella, flat repo) is testable without a filesystem — and then
 * re-tested against real git fixtures, which is what catches the cases a
 * hand-written probe would encode wrongly.
 */
import { basename, dirname, join, sep } from "node:path";

export type WorktreeEntry = {
  path: string;
  branch?: string;
  bare: boolean;
  detached: boolean;
  prunable: boolean;
};

export type GitProbe = {
  /** undefined when the directory is not inside a git repository. */
  isBare: (cwd: string) => Promise<boolean | undefined>;
  /** Parsed `git worktree list --porcelain`; the FIRST entry is the main worktree. */
  worktrees: (cwd: string) => Promise<readonly WorktreeEntry[] | undefined>;
  /** `git rev-parse --show-toplevel`: the working tree of the CURRENT checkout. */
  showToplevel: (cwd: string) => Promise<string | undefined>;
  checkIgnore: (
    cwd: string,
    path: string,
  ) => Promise<"ignored" | "not-ignored" | "outside-repo">;
};

export type FsProbe = {
  realpath: (path: string) => Promise<string | undefined>;
  exists: (path: string) => Promise<boolean>;
  /** Names of the first-level entries, or undefined when unreadable. */
  listEntries: (path: string) => Promise<readonly string[] | undefined>;
};

export type Probes = { git: GitProbe; fs: FsProbe };

/**
 * `umbrella` — the parent holds sibling repos and shared notes, so that is where
 * `@parent:` points and where `.wt/` lives.
 * `plain` — the parent is just a projects folder; `@parent:` is the main checkout.
 * `ask` — no confident verdict; the caller asks once and writes the answer down.
 */
export type UmbrellaVerdict = "umbrella" | "plain" | "ask";

export type UmbrellaReason =
  | "declared-parent"
  | "declared-repo"
  | "too-many-siblings"
  | "parent-ignores-repo"
  | "undecided"
  | "forced";

export type GuardId =
  | "worktrees-root-is-a-repo"
  | "worktrees-root-in-foreign-repo"
  | "worktrees-root-inside-repo";

export type Guard = { id: GuardId; violated: boolean; message: string };

export type Topology = {
  /** The MAIN worktree, never a linked one. */
  repoRoot: string;
  repoName: string;
  /** True when the starting directory was a linked worktree of this repo. */
  startedInLinkedWorktree: boolean;
  parent: string;
  parentIsRepo: boolean;
  umbrella: UmbrellaVerdict;
  umbrellaReason: UmbrellaReason;
  /** Where `@parent:` opens, once the verdict is settled. */
  contextRoot: string;
  /** Where `.wt/` lives. */
  configRoot: string;
  worktreesRoot: string;
  guards: readonly Guard[];
};

export type TopologyErrorCode =
  | "not-a-repo"
  | "bare-repo"
  | "broken-layout"
  | "unreadable";

export type TopologyResult =
  | { kind: "ok"; topology: Topology }
  | { kind: "error"; code: TopologyErrorCode; message: string };

export type TopologyInput = {
  startDir: string;
  /** From `--umbrella` / `--no-umbrella`; skips the heuristics entirely. */
  forceUmbrella?: boolean;
  /** Overrides `<parent>/.worktrees`. */
  worktreesDir?: string;
};

/** Directory name for worktrees. Dotted so it never shows up in a repo listing. */
export const WORKTREES_DIR = ".worktrees";
export const CONFIG_DIR = ".wt";

/**
 * Above this many first-level entries, a directory is a projects folder, not an
 * umbrella. ~/Projects has 61; tercio has 11.
 */
export const MAX_UMBRELLA_SIBLINGS = 25;

const isInsideGitDir = (path: string): boolean =>
  path.split(sep).includes(".git");

const decideUmbrella = async (
  parent: string,
  repoRoot: string,
  parentIsRepo: boolean,
  probes: Probes,
  forced: boolean | undefined,
): Promise<{ verdict: UmbrellaVerdict; reason: UmbrellaReason }> => {
  if (forced !== undefined) {
    return { verdict: forced ? "umbrella" : "plain", reason: "forced" };
  }

  // An explicit .wt/ is wt's own answer from last time. It beats every
  // heuristic, including the veto: the user may have said yes deliberately.
  if (await probes.fs.exists(join(parent, CONFIG_DIR))) {
    return { verdict: "umbrella", reason: "declared-parent" };
  }
  if (await probes.fs.exists(join(repoRoot, CONFIG_DIR))) {
    return { verdict: "plain", reason: "declared-repo" };
  }

  const siblings = await probes.fs.listEntries(parent);
  if (siblings !== undefined && siblings.length > MAX_UMBRELLA_SIBLINGS) {
    return { verdict: "plain", reason: "too-many-siblings" };
  }

  // The FEPEM shape: a shared repo that names its child repos in .gitignore so
  // their .git never becomes an accidental submodule. That is a deliberate
  // umbrella, stated in the only place git lets you state it.
  if (parentIsRepo) {
    const ignored = await probes.git.checkIgnore(parent, repoRoot);
    if (ignored === "ignored") {
      return { verdict: "umbrella", reason: "parent-ignores-repo" };
    }
  }

  return { verdict: "ask", reason: "undecided" };
};

const buildGuards = async (
  worktreesRoot: string,
  repoRoot: string,
  parent: string,
  probes: Probes,
): Promise<Guard[]> => {
  const guards: Guard[] = [];

  const rootWorktrees = await probes.git.worktrees(worktreesRoot);
  const rootIsRepoItself =
    rootWorktrees !== undefined &&
    (await probes.fs.realpath(rootWorktrees[0]?.path ?? "")) ===
      (await probes.fs.realpath(worktreesRoot));

  guards.push({
    id: "worktrees-root-is-a-repo",
    violated: rootIsRepoItself,
    message: `${worktreesRoot} is itself a git repository; worktrees cannot live inside it`,
  });

  // Being inside SOME repo is fine when that repo is the parent (the FEPEM
  // shape, handled by .gitignore). Being inside a different one is not.
  const foreign =
    rootWorktrees !== undefined &&
    !rootIsRepoItself &&
    (await probes.fs.realpath(rootWorktrees[0]?.path ?? "")) !==
      (await probes.fs.realpath(parent));

  guards.push({
    id: "worktrees-root-in-foreign-repo",
    violated: foreign,
    message: `${worktreesRoot} sits inside a git repository that is not ${parent}`,
  });

  guards.push({
    id: "worktrees-root-inside-repo",
    violated:
      worktreesRoot === repoRoot || worktreesRoot.startsWith(repoRoot + sep),
    message: `${worktreesRoot} is inside the repository itself`,
  });

  return guards;
};

export const detectTopology = async (
  input: TopologyInput,
  probes: Probes,
): Promise<TopologyResult> => {
  const startDir = await probes.fs.realpath(input.startDir);
  if (startDir === undefined) {
    return {
      kind: "error",
      code: "unreadable",
      message: `cannot resolve ${input.startDir}`,
    };
  }

  const bare = await probes.git.isBare(startDir);
  if (bare === undefined) {
    return {
      kind: "error",
      code: "not-a-repo",
      message: `${startDir} is not inside a git repository`,
    };
  }
  if (bare) {
    return {
      kind: "error",
      code: "bare-repo",
      message:
        "this is a bare repository; wt needs a checkout to derive the worktree layout from",
    };
  }

  // The main worktree comes from git itself, never from dirname(--git-common-dir):
  // that derivation returns the parent of the bare repo for a worktree of a bare
  // repo, and `<super>/.git/modules` for a worktree of a submodule — which would
  // put worktreesRoot inside .git.
  const worktrees = (await probes.git.worktrees(startDir)) ?? [];
  const mainEntry = worktrees[0];
  if (mainEntry === undefined) {
    return {
      kind: "error",
      code: "broken-layout",
      message: `git lists no worktree for ${startDir}`,
    };
  }

  const listed = (await probes.fs.realpath(mainEntry.path)) ?? mainEntry.path;

  // Measured, and not documented anywhere obvious: inside a SUBMODULE,
  // `git worktree list --porcelain` reports the GITDIR
  // (`<super>/.git/modules/sub`) as the worktree path, not the working tree.
  // Trusting it verbatim would put worktreesRoot inside .git.
  let repoRoot = listed;
  if (isInsideGitDir(listed)) {
    const toplevel = await probes.git.showToplevel(startDir);
    const resolved =
      toplevel === undefined ? undefined : await probes.fs.realpath(toplevel);

    if (resolved === undefined || isInsideGitDir(resolved)) {
      return {
        kind: "error",
        code: "broken-layout",
        message: `git reports the main checkout as ${listed}, which is inside a .git directory, and no usable working tree could be resolved`,
      };
    }

    // `--show-toplevel` answers for the CURRENT checkout. If that is one of the
    // linked entries, we are in a worktree of a submodule and cannot name the
    // submodule's own main checkout — a clear refusal beats a wrong path.
    const others = await Promise.all(
      worktrees.slice(1).map((entry) => probes.fs.realpath(entry.path)),
    );
    if (others.includes(resolved)) {
      return {
        kind: "error",
        code: "broken-layout",
        message:
          "this is a linked worktree of a submodule, which wt does not support yet",
      };
    }
    repoRoot = resolved;
  }

  if (!(await probes.fs.exists(join(repoRoot, ".git")))) {
    return {
      kind: "error",
      code: "broken-layout",
      message: `${repoRoot} has no .git entry`,
    };
  }

  const startedInLinkedWorktree = startDir !== repoRoot;
  const parent = dirname(repoRoot);
  const parentIsRepo = (await probes.git.isBare(parent)) !== undefined;

  const { verdict, reason } = await decideUmbrella(
    parent,
    repoRoot,
    parentIsRepo,
    probes,
    input.forceUmbrella,
  );

  // `plain` means @parent: opens the main checkout, not ~/Projects: a pane in a
  // folder of 61 projects is useless.
  const contextRoot = verdict === "umbrella" ? parent : repoRoot;
  const worktreesRoot = input.worktreesDir ?? join(parent, WORKTREES_DIR);

  return {
    kind: "ok",
    topology: {
      repoRoot,
      repoName: basename(repoRoot),
      startedInLinkedWorktree,
      parent,
      parentIsRepo,
      umbrella: verdict,
      umbrellaReason: reason,
      contextRoot,
      configRoot: contextRoot,
      worktreesRoot,
      guards: await buildGuards(worktreesRoot, repoRoot, parent, probes),
    },
  };
};

export const violatedGuards = (topology: Topology): readonly Guard[] =>
  topology.guards.filter((guard) => guard.violated);
