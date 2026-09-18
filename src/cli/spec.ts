/** Read by both the parser and `wt help`, so the two cannot drift. */
export type OptionArity = "none" | "required";

export type OptionGroup = "selection" | "behaviour" | "output";

export type OptionSpec = {
  long: string;
  short?: string;
  arity: OptionArity;
  /** Also accepts `--no-<long>`. */
  negatable?: boolean;
  placeholder?: string;
  group: OptionGroup;
  help: string;
};

export type PositionalSpec = {
  name: string;
  required: boolean;
  choices?: readonly string[];
  help: string;
};

export type CommandSpec = {
  name: string;
  aliases?: readonly string[];
  summary: string;
  description: string;
  positionals: readonly PositionalSpec[];
  options: readonly OptionSpec[];
  examples: readonly string[];
  section: "create" | "navigate" | "clean" | "configure";
};

const REPO_OPTION: OptionSpec = {
  long: "repo",
  arity: "required",
  placeholder: "<name>",
  group: "selection",
  help: "Target repository, bypassing positional resolution",
};

const BRANCH_OPTION: OptionSpec = {
  long: "branch",
  arity: "required",
  placeholder: "<name>",
  group: "selection",
  help: "Branch name, bypassing positional resolution",
};

const FOCUS_OPTION: OptionSpec = {
  long: "focus",
  arity: "none",
  negatable: true,
  group: "behaviour",
  help: "Focus the space afterwards (default: only on a TTY)",
};

const LAYOUT_OPTION: OptionSpec = {
  long: "layout",
  arity: "required",
  placeholder: "<dsl>",
  group: "behaviour",
  help: 'Pane layout, e.g. "(@parent:claude | (@wt:shell _ @wt:bin/dev))"',
};

export const GLOBAL_OPTIONS: readonly OptionSpec[] = [
  {
    long: "help",
    short: "h",
    arity: "none",
    group: "output",
    help: "Print help for the command",
  },
  {
    long: "version",
    short: "V",
    arity: "none",
    group: "output",
    help: "Print the version",
  },
  {
    long: "json",
    arity: "none",
    group: "output",
    help: "Machine-readable output on stdout; implies --no-color and --yes",
  },
  {
    long: "yes",
    short: "y",
    arity: "none",
    group: "behaviour",
    help: "Assume yes; never prompt",
  },
  {
    long: "color",
    arity: "none",
    negatable: true,
    group: "output",
    help: "Colourise output (default: only on a TTY, and unless NO_COLOR is set)",
  },
  {
    long: "verbose",
    arity: "none",
    group: "output",
    help: "Print every git and herdr call",
  },
  {
    long: "dry-run",
    arity: "none",
    group: "behaviour",
    help: "Print the plan without running anything",
  },
  {
    long: "cwd",
    arity: "required",
    placeholder: "<path>",
    group: "selection",
    help: "Resolve the topology from this directory instead of the current one",
  },
  {
    long: "prune",
    arity: "none",
    negatable: true,
    group: "behaviour",
    help: "Prune stale worktrees first (default: on)",
  },
];

export const COMMANDS: readonly CommandSpec[] = [
  {
    name: "new",
    summary: "Create a worktree and open its space",
    description:
      "Creates the branch if needed, tracking its remote counterpart when there is one, " +
      "provisions the checkout, then opens a herdr space laid out by the DSL.",
    section: "create",
    positionals: [
      { name: "repo", required: false, help: "Repository, when ambiguous" },
      { name: "branch", required: true, help: "Branch to work on" },
    ],
    options: [
      REPO_OPTION,
      BRANCH_OPTION,
      {
        long: "as",
        arity: "required",
        placeholder: "<label>",
        group: "selection",
        help: "Short name for the space (default: last segment of the branch)",
      },
      {
        long: "from",
        arity: "required",
        placeholder: "<ref>",
        group: "behaviour",
        help: "Base for a new branch (rejected if the branch already exists)",
      },
      LAYOUT_OPTION,
      {
        long: "umbrella",
        arity: "none",
        negatable: true,
        group: "behaviour",
        help: "Treat the parent directory as an umbrella (default: asked once, then remembered)",
      },
      {
        long: "open",
        arity: "none",
        negatable: true,
        group: "behaviour",
        help: "Open a herdr space (default: on)",
      },
      {
        long: "provision",
        arity: "none",
        negatable: true,
        group: "behaviour",
        help: "Run the provisioning steps (default: on)",
      },
      {
        long: "fetch",
        arity: "none",
        negatable: true,
        group: "behaviour",
        help: "Look the branch up on the remote before creating it (default: on)",
      },
      {
        long: "gitignore",
        arity: "none",
        negatable: true,
        group: "behaviour",
        help: "Add the worktree directory to the parent's .gitignore (default: on)",
      },
      FOCUS_OPTION,
    ],
    examples: [
      "wt new investigations/import-cmdb --as CMDB",
      "wt new tercioapp investigations/import-cmdb --as CMDB",
    ],
  },
  {
    name: "open",
    aliases: ["go"],
    summary: "Focus the space of an existing worktree",
    description:
      "Focuses the herdr space bound to the worktree, and recreates it if it is gone. " +
      "Accepts a branch, a directory slug or a path.",
    section: "navigate",
    positionals: [
      { name: "repo", required: false, help: "Repository, when ambiguous" },
      { name: "target", required: true, help: "Branch, slug or path" },
    ],
    options: [REPO_OPTION, BRANCH_OPTION, LAYOUT_OPTION, FOCUS_OPTION],
    examples: ["wt open investigations/import-cmdb", "wt go CMDB"],
  },
  {
    name: "ls",
    aliases: ["list"],
    summary: "List the worktrees of a repository",
    description:
      "Shows each worktree with its branch, its git state and whether a herdr space is open on it.",
    section: "navigate",
    positionals: [],
    options: [
      REPO_OPTION,
      {
        long: "all",
        arity: "none",
        group: "selection",
        help: "Include worktrees wt does not manage, such as herdr's own",
      },
    ],
    examples: ["wt ls", "wt ls --all --json"],
  },
  {
    name: "status",
    summary: "Show the state of a worktree",
    description:
      "Reports git state, provisioning state and herdr binding for one worktree, or for all of them.",
    section: "navigate",
    positionals: [
      { name: "target", required: false, help: "Branch, slug or path" },
    ],
    options: [REPO_OPTION],
    examples: ["wt status", "wt status investigations/import-cmdb"],
  },
  {
    name: "rm",
    aliases: ["remove", "del"],
    summary: "Remove a worktree and close its space",
    description:
      "Refuses when the checkout holds unsaved work: uncommitted changes, untracked files, " +
      "unpublished commits or a git operation in progress.",
    section: "clean",
    positionals: [
      { name: "repo", required: false, help: "Repository, when ambiguous" },
      { name: "target", required: true, help: "Branch, slug or path" },
    ],
    options: [
      REPO_OPTION,
      BRANCH_OPTION,
      {
        long: "force",
        arity: "none",
        group: "behaviour",
        help: "Remove anyway, discarding whatever the guards found",
      },
      {
        long: "delete-branch",
        arity: "none",
        negatable: true,
        group: "behaviour",
        help: "Also delete the git branch (default: keep it)",
      },
      {
        long: "keep-space",
        arity: "none",
        group: "behaviour",
        help: "Leave the herdr space open",
      },
    ],
    examples: ["wt rm investigations/import-cmdb", "wt rm CMDB --force"],
  },
  {
    name: "prune",
    summary: "Clean up stale worktrees",
    description:
      "Runs git worktree prune and reports directories git no longer knows about. Never deletes them.",
    section: "clean",
    positionals: [],
    options: [REPO_OPTION],
    examples: ["wt prune"],
  },
  {
    name: "provision",
    summary: "Replay the provisioning of a worktree",
    description:
      "Copies the declared files and runs the setup commands again. Idempotent: steps already " +
      "done are skipped, interrupted ones are retried.",
    section: "configure",
    positionals: [
      { name: "repo", required: false, help: "Repository, when ambiguous" },
      { name: "branch", required: true, help: "Branch of the worktree" },
    ],
    options: [REPO_OPTION, BRANCH_OPTION],
    examples: ["wt provision investigations/import-cmdb"],
  },
  {
    name: "layout",
    summary: "Work with the pane layout DSL",
    description:
      '`wt layout check "<dsl>"` parses a layout and draws it, touching nothing else.',
    section: "configure",
    positionals: [
      {
        name: "action",
        required: true,
        choices: ["check"],
        help: "What to do",
      },
      { name: "dsl", required: true, help: "The layout expression" },
    ],
    options: [],
    examples: [
      'wt layout check "(@parent:claude | (@wt:shell _ @wt:bin/dev))"',
    ],
  },
  {
    name: "config",
    summary: "Inspect or edit the .wt/ configuration",
    description:
      "`init` writes the file for a repository, `show` prints the merged result, " +
      "`path` prints its location, `edit` opens it in $EDITOR.",
    section: "configure",
    positionals: [
      {
        name: "action",
        required: true,
        choices: ["init", "show", "path", "edit"],
        help: "What to do",
      },
      { name: "repo", required: false, help: "Repository, when ambiguous" },
    ],
    options: [REPO_OPTION],
    examples: ["wt config show", "wt config edit tercioapp"],
  },
  {
    name: "doctor",
    summary: "Check the environment and the resolved topology",
    description:
      "Reports git, herdr and configuration health, and what wt resolved from the current directory. " +
      "This is what to run first when something behaves oddly.",
    section: "configure",
    positionals: [],
    options: [],
    examples: ["wt doctor", "wt doctor --json"],
  },
  {
    name: "completion",
    summary: "Print a shell completion script",
    description: "Write the output to a file your shell loads at startup.",
    section: "configure",
    positionals: [
      {
        name: "shell",
        required: true,
        choices: ["zsh"],
        help: "Target shell",
      },
    ],
    options: [],
    examples: ["wt completion zsh > ~/.zsh/completions/_wt"],
  },
  {
    name: "help",
    summary: "Print help",
    description: "With no argument, lists every command grouped by intent.",
    section: "configure",
    positionals: [
      { name: "command", required: false, help: "Command to explain" },
    ],
    options: [],
    examples: ["wt help", "wt help new"],
  },
];

export const findCommand = (name: string): CommandSpec | undefined =>
  COMMANDS.find(
    (command) => command.name === name || command.aliases?.includes(name),
  );

export const SECTION_TITLES: Record<CommandSpec["section"], string> = {
  create: "Create",
  navigate: "Navigate",
  clean: "Clean up",
  configure: "Configure",
};

export const GROUP_TITLES: Record<OptionGroup, string> = {
  selection: "Selection",
  behaviour: "Behaviour",
  output: "Output",
};
