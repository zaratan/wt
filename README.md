# wt

Git worktree manager integrated with [herdr](https://herdr.dev).

`wt` creates the worktree, provisions it (secrets that git does not carry, dependency
install, setup scripts), and opens a herdr space with a pane layout described by a
small DSL — so a new branch goes from nothing to a working terminal in one command.

```bash
wt new tercioapp investigations/import-cmdb --as CMDB
```

## Install

```bash
brew tap zaratan/dev
brew install wt
```

The formula is macOS arm64. Everywhere else, the install script picks the right binary:

```bash
curl -fL https://raw.githubusercontent.com/zaratan/wt/main/scripts/install.sh | bash
```

It verifies the download against the release's `SHA256SUMS` and installs to
`~/.local/bin`. `WT_VERSION=v0.1.0` pins a version, `WT_INSTALL_DIR` moves the target.

Shell completion, generated from the same table the parser reads:

```bash
wt completion zsh > "$(brew --prefix)/share/zsh/site-functions/_wt"
```

`wt` drives herdr and does little without it.

## The three layouts it works from

`wt` resolves where worktrees and configuration belong from the shape of the directory,
and `wt doctor` always prints the verdict and the reason for it.

**A plain repository.** `~/Projects/konnect`. Worktrees go in
`~/Projects/.worktrees/konnect/<slug>`, configuration in `konnect/.wt/`.

**A working folder holding several repositories.** `~/Projects/tercio` — not a git
repository itself, holding `tercioapp`, `infra`, notes. Worktrees go in
`tercio/.worktrees/`, configuration in `tercio/.wt/`, one file per sub-repository, and
`@parent:` panes open in `tercio` so an agent sees the notes and the sibling repos.

**A shared git parent that ignores its children.** `~/Projects/FEPEM`, a repository whose
`.gitignore` names `platform`. Naming a child in `.gitignore` is the only way git lets you
declare it, so `wt` reads that as deliberate and treats the parent as the working folder.

When nothing decides it — a parent that is not a repository and holds few enough entries —
`wt` asks once, on a terminal, and records the answer by creating `.wt/` on the chosen
side. Without a terminal it stays on the repository, and `wt doctor` says so rather than
pretending it knew. `--umbrella` / `--no-umbrella` force it.

## Commands

```bash
wt new [repo] <branch>       # create, provision, open   --as --from --layout --no-open
wt open [repo] <target>      # focus an existing worktree's space
wt ls [--all]                # worktrees, their git state, and their herdr space
wt status [target]           # detail: git, provisioning, space
wt rm [repo] <target>        # remove it, refusing to discard work
wt prune                     # drop stale entries
wt provision [repo] <branch> # replay the provisioning, idempotent
wt layout check "<dsl>"      # parse a layout and draw it, touching nothing
wt config init|show|path|edit
wt doctor                    # what wt resolves from here, and what is wrong
wt completion zsh
```

A target is whatever `wt ls` prints: the branch, the directory name, or a path. When
several repositories live under the current directory, `wt` offers a picker on a terminal
and lists the candidates everywhere else — naming one as an argument skips the question.

`wt help <command>` prints the options and two real examples for each.

## The layout DSL

```
(@parent:claude | (@wt:shell _ @wt:bin/dev))
```

`|` places panes side by side, `_` stacks them, and parentheses group. Every leaf declares
its working directory: `@wt:` is the worktree, `@parent:` is the working folder (or the
main checkout for a plain repository). `@wt` on its own is a bare shell.

**Operators are only operators when surrounded by spaces**, because `_` is everywhere in
command names: `@wt:bin/dev_server` stays one command. Quote anything that contains an
operator: `@wt:"a | b"`. Mixing `|` and `_` at one level is refused, with the caret under
the offending operator.

Panes are never born with their command attached. They open as bare shells and the command
is typed into them, so mise, asdf and your `.zshrc` apply exactly as they would by hand,
and Ctrl-C gives you a prompt instead of killing the pane.

The default is `(@parent:claude | @wt:shell)`. Set `space.layout` per repository to change
it. `wt layout check` draws one without touching anything.

## Configuration

Three layers, each overriding the one before, then the flags:

```
~/.config/wt/config.toml         # yours, everywhere
<root>/.wt/defaults.toml         # shared by the sub-repositories
<root>/.wt/<repo>.toml           # one per repository
```

`<root>` is the working folder, or the repository itself when it stands alone. The file
name is the same in both cases, so a repository that later moves under a working folder
needs only a `mv`.

The first `wt new` in an unknown repository detects and writes the file: package manager,
install command (`bin/setup` when it is tracked and executable), dev command, default base
branch, and the ignored files worth copying — `.env`, key material, Rails master keys —
each with the reason it was proposed. Anything large is written commented out, with its
measurement. `wt config init` does the same on demand.

Arrays replace rather than merge, so a repository can drop a step it inherits.

## Exit codes

|       |                                                                              |
| ----- | ---------------------------------------------------------------------------- |
| `0`   | success                                                                      |
| `1`   | error                                                                        |
| `2`   | CLI syntax error, aligned with herdr                                         |
| `3`   | partial success — the worktree exists, the provisioning or the space did not |
| `130` | interrupted by Ctrl-C, after the state was recorded                          |

`3` is what an agent branches on: it means created but not ready. `wt status` then names
the step that failed and the command to replay it.

## Caveats

- **Ports and databases are not isolated.** Two worktrees of the same project share the
  dev database and the same ports. Running both dev servers at once will collide. Out of
  scope for v1, by decision.
- herdr creates worktrees of its own (`prefix+shift+g`, under `~/.herdr/worktrees`). `wt`
  never touches them; `wt ls --all` shows them as unmanaged, and `wt prune` leaves them be.

## Development

The toolchain is pinned in [`mise.toml`](./mise.toml) — bun, node and pnpm. With
[mise](https://mise.jdx.dev) installed, `mise install` gets you the exact versions CI uses,
since the workflows run `jdx/mise-action` against the same file.

```bash
mise install
pnpm install
pnpm dev              # run the CLI in the current directory
pnpm test             # vitest
pnpm check            # lint + typecheck + format:check + test — must be green
pnpm build            # darwin-arm64 + linux-x64 binaries into dist/
```

bun is pinned **exactly**: `bun build --compile` embeds the runtime in the shipped binary,
so its version is part of the artifact, not just of the build.

### Architecture

```
src/
  index.tsx       the ONLY place that reads process.cwd() / process.env
  cli/            argv → ADT, help, exit codes, dispatch
  commands/       orchestration: sequences lib/ calls, returns a Result
  lib/            domain logic; never ink, never react
    exec/         the ONLY place that imports node:child_process
  format/         pure presentation; node:path allowed, no other node:
  ui/             the only place with ink/react
```

Every sub-process goes through `lib/exec/run.ts`, which is what makes environment
scrubbing, timeouts and process-group kills exist once rather than seven times.

These boundaries are enforced by `eslint.config.js` **and proven** by
`src/lib/boundaries.test.ts`, which lints real files on disk in both directions. A lint
rule that silently stops matching is worse than no rule; [CLAUDE.md](./CLAUDE.md) records
the two ways that has already happened here, along with the git and herdr behaviours
measured on this machine rather than read from a manual.

## Release

Push a semver tag; GitHub Actions builds both binaries, publishes them as tarballs with a
`SHA256SUMS`, and flags any tag containing a hyphen as a pre-release. The Homebrew formula
is bumped by a daily job in [the tap](https://github.com/zaratan/homebrew-dev).

```bash
git tag v0.1.2 && git push --tags
```

## License

MIT © 2026 Denis <Zaratan> Pasin
