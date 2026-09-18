import { createHash } from "node:crypto";

/** APFS caps a path component at 255 bytes; a branch named after a ticket gets close. */
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

/** `a/b` and `a-b` slug to the same directory; this tells them apart. */
export const disambiguator = (branch: string): string =>
  createHash("sha1").update(branch).digest("hex").slice(0, 6);

/** The repository is the directory above, so the name carries only the slug. */
export const worktreeDirName = (slug: string): string => slug;

/** APFS is case-insensitive, so two names differing only in case collide. */
export const sameDirName = (a: string, b: string): boolean =>
  a.toLowerCase() === b.toLowerCase();
