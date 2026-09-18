# wt

Git worktree manager integrated with [herdr](https://herdr.dev).

`wt` creates the worktree, provisions it (secrets that git does not carry, dependency
install, setup scripts), and opens a herdr space with a pane layout described by a
small DSL — so a new branch goes from nothing to a working terminal in one command.

> **Status: early.** The scaffold and the exec layer are in place. The CLI surface
> below is the target, not what ships today.

## Install

```bash
curl -fL https://raw.githubusercontent.com/zaratan/wt/main/scripts/install.sh | bash
```

Pin a specific version:

```bash
WT_VERSION=v0.1.0 bash <(curl -fL https://raw.githubusercontent.com/zaratan/wt/main/scripts/install.sh)
```

## Development

The toolchain is pinned in [`mise.toml`](./mise.toml) — bun, node and pnpm. With
[mise](https://mise.jdx.dev) installed, `mise install` gets you the exact versions
CI uses, since the workflows run `jdx/mise-action` against the same file.

```bash
mise install
pnpm install
pnpm dev              # run the CLI in the current directory
pnpm dev:watch        # same, with hot reload
pnpm test             # vitest
pnpm check            # lint + typecheck + format:check + test — must be green
pnpm build            # darwin-arm64 + linux-x64 binaries into dist/
```

bun is pinned **exactly**: `bun build --compile` embeds the runtime in the shipped
binary, so its version is part of the artifact, not just of the build.

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

These boundaries are enforced by `eslint.config.js` **and proven** by
`src/lib/boundaries.test.ts` — a lint rule that silently stops matching is worse
than no rule. See [CLAUDE.md](./CLAUDE.md) for the two ways that happens.

## Caveats

- **Ports and databases are not isolated.** Two worktrees of the same project share
  the dev database and the same ports. Running both dev servers at once will
  collide. Out of scope for v1, by decision.
- herdr can create worktrees of its own (`prefix+shift+g`, under `~/.herdr/worktrees`).
  `wt` leaves those alone; `wt ls --all` shows them as unmanaged.

## Release

Push a semver tag and GitHub Actions publishes both binaries:

```bash
git tag v0.1.0
git push --tags
```

## Notes

Dependency versions are **pinned exact** to the scaffold snapshot. To refresh:

```bash
pnpm up --latest
```

## License

MIT © 2026 Denis <Zaratan> Pasin
