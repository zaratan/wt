import { basename, dirname, join, sep } from "node:path";

export type WorktreeEntry = {
  path: string;
  branch?: string;
  bare: boolean;
  detached: boolean;
  prunable: boolean;
};

export type GitProbe = {
  /** undefined outside a git repository. */
  isBare: (cwd: string) => Promise<boolean | undefined>;
  /** Parsed `git worktree list --porcelain`; the first entry is the main worktree. */
  worktrees: (cwd: string) => Promise<readonly WorktreeEntry[] | undefined>;
  /** `git rev-parse --show-toplevel`: the CURRENT checkout, not the main one. */
  showToplevel: (cwd: string) => Promise<string | undefined>;
  checkIgnore: (
    cwd: string,
    path: string,
  ) => Promise<"ignored" | "not-ignored" | "outside-repo">;
};

export type FsProbe = {
  realpath: (path: string) => Promise<string | undefined>;
  exists: (path: string) => Promise<boolean>;
  isDirectory: (path: string) => Promise<boolean>;
  listEntries: (path: string) => Promise<readonly string[] | undefined>;
};

export type Probes = { git: GitProbe; fs: FsProbe };

export type UmbrellaVerdict = "umbrella" | "plain";

export type UmbrellaReason =
  | "declared-parent"
  | "declared-repo"
  | "too-many-siblings"
  | "parent-ignores-repo"
  | "answered"
  | "undecided"
  | "forced";

export type GuardId =
  | "worktrees-root-is-a-repo"
  | "worktrees-root-in-foreign-repo"
  | "worktrees-root-inside-repo";

export type Guard = {
  id: GuardId;
  violated: boolean;
  message: string;
  fix?: string;
};

export type Topology = {
  /** The main worktree, never a linked one. */
  repoRoot: string;
  repoName: string;
  startedInLinkedWorktree: boolean;
  parent: string;
  parentIsRepo: boolean;
  umbrella: UmbrellaVerdict;
  umbrellaReason: UmbrellaReason;
  /** Where `@parent:` opens. */
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
  forceUmbrella?: boolean;
  worktreesDir?: string;
  askUmbrella?: UmbrellaAsk;
};

export const WORKTREES_DIR = ".worktrees";
export const CONFIG_DIR = ".wt";

/** Above this, a directory is a projects folder, not an umbrella. */
export const MAX_UMBRELLA_SIBLINGS = 25;

const isInsideGitDir = (path: string): boolean =>
  path.split(sep).includes(".git");

export type UmbrellaQuestion = { parent: string; repoRoot: string };

/** Answers the question and records the answer; undefined means "cannot ask". */
export type UmbrellaAsk = (
  question: UmbrellaQuestion,
) => Promise<boolean | undefined>;

const decideUmbrella = async (
  parent: string,
  repoRoot: string,
  parentIsRepo: boolean,
  probes: Probes,
  forced: boolean | undefined,
  ask: UmbrellaAsk | undefined,
): Promise<{ verdict: UmbrellaVerdict; reason: UmbrellaReason }> => {
  if (forced !== undefined) {
    return { verdict: forced ? "umbrella" : "plain", reason: "forced" };
  }

  // wt's own answer from last time, so it beats every heuristic including the veto.
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

  // Naming a child repo in .gitignore is the only way git lets you declare it,
  // so a parent that does it is deliberately an umbrella.
  if (parentIsRepo) {
    const ignored = await probes.git.checkIgnore(parent, repoRoot);
    if (ignored === "ignored") {
      return { verdict: "umbrella", reason: "parent-ignores-repo" };
    }
  }

  const answer =
    ask === undefined ? undefined : await ask({ parent, repoRoot });
  if (answer !== undefined) {
    return { verdict: answer ? "umbrella" : "plain", reason: "answered" };
  }

  return { verdict: "plain", reason: "undecided" };
};

const buildGuards = async (
  worktreesRoot: string,
  repoRoot: string,
  parent: string,
  probes: Probes,
): Promise<Guard[]> => {
  const guards: Guard[] = [];

  // Probe the PARENT, not worktreesRoot: the latter does not exist on a first
  // run, so the guard would stay silent then block forever once created.
  const enclosing = await probes.git.worktrees(parent);
  const enclosingRoot =
    enclosing === undefined
      ? undefined
      : await probes.fs.realpath(enclosing[0]?.path ?? "");

  const rootExists = await probes.fs.exists(worktreesRoot);
  const rootIsRepoItself =
    rootExists &&
    (await probes.fs.realpath(
      (await probes.git.worktrees(worktreesRoot))?.[0]?.path ?? "",
    )) === (await probes.fs.realpath(worktreesRoot));

  guards.push({
    id: "worktrees-root-is-a-repo",
    violated: rootIsRepoItself,
    message: `${worktreesRoot} is itself a git repository; worktrees cannot live inside it`,
    fix: `move or rename ${worktreesRoot}, then run wt again`,
  });

  // Being inside a repo is only a problem if that repo will track the
  // worktrees. `ensureIgnored` is the remedy wt applies itself, so an ignored
  // location is fine wherever it sits.
  const ignored =
    enclosingRoot === undefined
      ? "outside-repo"
      : await probes.git.checkIgnore(enclosingRoot, `${WORKTREES_DIR}/`);

  const foreign =
    enclosingRoot !== undefined &&
    !rootIsRepoItself &&
    enclosingRoot !== (await probes.fs.realpath(parent)) &&
    ignored !== "ignored";

  guards.push({
    id: "worktrees-root-in-foreign-repo",
    violated: foreign,
    message: `${worktreesRoot} sits inside ${enclosingRoot ?? "another repository"}, which would track it`,
    fix:
      enclosingRoot === undefined
        ? undefined
        : `printf '/%s/\\n' ${WORKTREES_DIR} >> ${enclosingRoot}/.gitignore`,
  });

  guards.push({
    id: "worktrees-root-inside-repo",
    violated:
      worktreesRoot === repoRoot || worktreesRoot.startsWith(repoRoot + sep),
    message: `${worktreesRoot} is inside the repository itself`,
    fix: `run wt from ${parent} instead of from inside ${repoRoot}`,
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

  // Never dirname(--git-common-dir): it gives the bare repo's parent for a
  // worktree of a bare repo, and `<super>/.git/modules` for a submodule.
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

  // Inside a submodule this porcelain reports the GITDIR, not the working tree.
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

    // --show-toplevel answers for the current checkout, so matching a linked
    // entry means we cannot name the submodule's own main checkout.
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
    input.askUmbrella,
  );

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
