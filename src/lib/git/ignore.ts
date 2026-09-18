import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Git } from "./exec.js";

export type IgnoreOutcome =
  | { kind: "already" }
  | { kind: "added"; file: string }
  | { kind: "skipped"; reason: "not-a-repo" }
  | { kind: "failed"; message: string };

const banner = (entry: string): string =>
  [
    "",
    "# Worktrees created by wt. Git does not descend into an ignored directory,",
    "# so their .git never becomes an accidental submodule.",
    `/${entry}/`,
    "",
  ].join("\n");

/**
 * `git check-ignore -q .worktrees` answers "not ignored" while the directory
 * does not exist yet, even with `/.worktrees/` in the file: a trailing-slash
 * pattern only matches a slashless path once the directory is there. Asking
 * with the slash is what stops the line being re-added on every first `wt new`.
 */
export const isIgnored = async (
  git: Git,
  repoRoot: string,
  entry: string,
): Promise<boolean | undefined> => {
  const outcome = await git(["check-ignore", "-q", "--", `${entry}/`], {
    cwd: repoRoot,
  });
  if (outcome.kind !== "ran") return undefined;
  if (outcome.code === 0) return true;
  if (outcome.code === 1) return false;
  return undefined;
};

const mentions = (contents: string, entry: string): boolean =>
  contents
    .split("\n")
    .map((line) => line.trim())
    .some(
      (line) =>
        line === entry ||
        line === `/${entry}` ||
        line === `${entry}/` ||
        line === `/${entry}/`,
    );

export const ensureIgnored = async (
  git: Git,
  repoRoot: string,
  entry: string,
): Promise<IgnoreOutcome> => {
  const ignored = await isIgnored(git, repoRoot, entry);
  if (ignored === undefined) return { kind: "skipped", reason: "not-a-repo" };
  if (ignored) return { kind: "already" };

  const file = join(repoRoot, ".gitignore");
  let contents = "";
  try {
    contents = await readFile(file, "utf8");
  } catch {
    contents = "";
  }

  if (mentions(contents, entry)) return { kind: "already" };

  // A .gitignore with no trailing newline would otherwise glue our first line
  // onto the last one, silently breaking both patterns.
  const needsNewline = contents !== "" && !contents.endsWith("\n");
  const next = `${contents}${needsNewline ? "\n" : ""}${banner(entry)}`;

  try {
    const temporary = `${file}.wt-tmp`;
    await writeFile(temporary, next, { mode: 0o644 });
    const { rename } = await import("node:fs/promises");
    await rename(temporary, file);
    return { kind: "added", file };
  } catch (error) {
    return {
      kind: "failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
};
