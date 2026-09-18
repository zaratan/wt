import { describe, it, expect } from "vitest";
import { scrubEnv, scrubGitEnv } from "./env.js";

const base: NodeJS.ProcessEnv = {
  PATH: "/usr/bin",
  HOME: "/Users/someone",
  LANG: "fr_FR.UTF-8",
  GIT_DIR: "/other/repo/.git",
  GIT_WORK_TREE: "/other/repo",
  GIT_INDEX_FILE: "/other/repo/.git/index",
  EMPTY: undefined,
};

describe("scrubEnv", () => {
  it("drops every inherited git variable", () => {
    const env = scrubEnv(base);
    expect(env.GIT_DIR).toBeUndefined();
    expect(env.GIT_WORK_TREE).toBeUndefined();
    expect(env.GIT_INDEX_FILE).toBeUndefined();
  });

  it("keeps everything else untouched, including the user locale", () => {
    const env = scrubEnv(base);
    expect(env.PATH).toBe("/usr/bin");
    expect(env.HOME).toBe("/Users/someone");
    expect(env.LANG).toBe("fr_FR.UTF-8");
  });

  it("drops keys whose value is undefined", () => {
    expect(Object.hasOwn(scrubEnv(base), "EMPTY")).toBe(false);
  });

  it("applies overrides, and unsets a key set to undefined", () => {
    const env = scrubEnv(base, { WT_BRANCH: "feat/x", HOME: undefined });
    expect(env.WT_BRANCH).toBe("feat/x");
    expect(Object.hasOwn(env, "HOME")).toBe(false);
  });

  it("does not mutate the source", () => {
    scrubEnv(base, { PATH: "/nope" });
    expect(base.GIT_DIR).toBe("/other/repo/.git");
    expect(base.PATH).toBe("/usr/bin");
  });
});

describe("scrubGitEnv", () => {
  it("pins the locale so error messages are classifiable", () => {
    const env = scrubGitEnv(base);
    expect(env.LC_ALL).toBe("C");
    expect(env.LANG).toBe("C");
    expect(env.LANGUAGE).toBe("C");
  });

  it("disables terminal prompts and optional locks", () => {
    const env = scrubGitEnv(base);
    expect(env.GIT_TERMINAL_PROMPT).toBe("0");
    expect(env.GIT_OPTIONAL_LOCKS).toBe("0");
  });

  it("still drops inherited git state", () => {
    expect(scrubGitEnv(base).GIT_DIR).toBeUndefined();
  });

  it("lets a caller override the pinned locale", () => {
    expect(scrubGitEnv(base, { LC_ALL: "fr_FR.UTF-8" }).LC_ALL).toBe(
      "fr_FR.UTF-8",
    );
  });
});
