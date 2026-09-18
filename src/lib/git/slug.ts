/**
 * Branch name → directory name.
 *
 * `investigations/import-cmdb` becomes `investigations-import-cmdb`, matching
 * what both herdr and the POC already produced on disk.
 */
import { createHash } from "node:crypto";

/**
 * APFS caps a path component at 255 bytes, and a branch name copied from a
 * ticket title gets close. Truncating keeps the directory readable; the
 * disambiguating suffix (added by the caller on collision) keeps it unique.
 */
export const MAX_SLUG_LENGTH = 100;

export type SlugResult =
  | { kind: "ok"; slug: string }
  | { kind: "error"; message: string };

export const slugify = (branch: string): SlugResult => {
  const slug = branch
    .replace(/\//g, "-")
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/[-.]+$/g, "");

  if (slug === "") {
    return {
      kind: "error",
      message: `branch name '${branch}' has no usable characters for a directory name`,
    };
  }
  return { kind: "ok", slug };
};

/**
 * Short, stable suffix used when two branches slug to the same directory —
 * `a/b` and `a-b` both want `a-b`.
 */
export const disambiguator = (branch: string): string =>
  createHash("sha1").update(branch).digest("hex").slice(0, 6);

/** The directory name for a worktree: `<repo>-<slug>`. */
export const worktreeDirName = (repoName: string, slug: string): string =>
  `${repoName}-${slug}`;

/**
 * Case-insensitive comparison, because APFS is. Two names that differ only in
 * case cannot coexist, so collision detection has to see them as equal.
 */
export const sameDirName = (a: string, b: string): boolean =>
  a.toLowerCase() === b.toLowerCase();
