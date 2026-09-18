import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig, configPaths } from "./load.js";
import { mergeConfigs, validateConfig, DEFAULT_CONFIG } from "./schema.js";
import { makeSandbox, type Sandbox } from "../../test/fixtures/git.js";

let sandbox: Sandbox;

beforeAll(async () => {
  sandbox = await makeSandbox();
});

afterAll(async () => {
  await sandbox.cleanup();
});

describe("validateConfig", () => {
  it("refuses a schema newer than this wt understands", () => {
    const result = validateConfig({ schema: 99 }, "x.toml");
    expect(result.kind).toBe("too-new");
  });

  it("warns about an unknown section instead of ignoring it", () => {
    const result = validateConfig({ nonsense: {} }, "x.toml");
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.parsed.warnings[0]?.message).toContain("nonsense");
  });

  it("warns about a misspelled key, which would otherwise fall back silently", () => {
    const result = validateConfig({ provision: { copyy: [] } }, "x.toml");
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.parsed.warnings[0]?.message).toContain("provision.copyy");
  });

  it("defaults an invalid delete_branch rather than failing", () => {
    const result = validateConfig({ remove: { delete_branch: "nope" } }, "x");
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.parsed.config.remove?.deleteBranch).toBe("ask");
  });
});

describe("mergeConfigs", () => {
  it("lets a later layer win", () => {
    const merged = mergeConfigs([
      DEFAULT_CONFIG,
      { space: { layout: "@wt" } },
      { space: { layout: "@parent" } },
    ]);
    expect(merged.space.layout).toBe("@parent");
  });

  it("REPLACES arrays rather than concatenating them", () => {
    const merged = mergeConfigs([
      { provision: { copy: [".env", "a.key"], timeoutMs: 1, commands: [] } },
      { provision: { copy: [".env"], timeoutMs: 1, commands: [] } },
    ]);
    expect(merged.provision.copy).toEqual([".env"]);
  });

  it("keeps an earlier value the later layer does not set", () => {
    const merged = mergeConfigs([
      { repo: { remote: "origin" } },
      { space: { layout: "@wt" } },
    ]);
    expect(merged.repo.remote).toBe("origin");
  });
});

describe("loadConfig", () => {
  const env = { HOME: "/nonexistent-home" };

  it("reports needsInit when the repo has no config yet", async () => {
    const root = join(sandbox.root, "noconfig");
    await mkdir(root, { recursive: true });

    const result = await loadConfig(env, root, "app");
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.loaded.needsInit).toBe(true);
    expect(result.loaded.sources).toEqual([]);
  });

  it("layers defaults.toml under the repo file", async () => {
    const root = join(sandbox.root, "layered");
    await mkdir(join(root, ".wt"), { recursive: true });
    await writeFile(
      join(root, ".wt", "defaults.toml"),
      'schema = 1\n[space]\nlayout = "@wt"\nlabel = "{repo} - {as}"\n',
    );
    await writeFile(
      join(root, ".wt", "app.toml"),
      'schema = 1\n[space]\nlayout = "@parent:claude"\n',
    );

    const result = await loadConfig(env, root, "app");
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.loaded.config.space.layout).toBe("@parent:claude");
    expect(result.loaded.config.space.label).toBe("{repo} - {as}");
    expect(result.loaded.needsInit).toBe(false);
  });

  it("refuses a file written for a newer schema, naming it", async () => {
    const root = join(sandbox.root, "future");
    await mkdir(join(root, ".wt"), { recursive: true });
    await writeFile(join(root, ".wt", "app.toml"), "schema = 7\n");

    const result = await loadConfig(env, root, "app");
    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected error");
    expect(result.message).toContain("upgrade wt");
  });

  it("reports a syntax error with its file", async () => {
    const root = join(sandbox.root, "broken");
    await mkdir(join(root, ".wt"), { recursive: true });
    await writeFile(join(root, ".wt", "app.toml"), "this is not = = toml\n");

    const result = await loadConfig(env, root, "app");
    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected error");
    expect(result.path).toContain("app.toml");
  });
});

describe("configPaths", () => {
  it("honours XDG_CONFIG_HOME for the global file", () => {
    const paths = configPaths(
      { HOME: "/home/me", XDG_CONFIG_HOME: "/xdg" },
      "/root",
      "app",
    );
    expect(paths.global).toBe("/xdg/wt/config.toml");
    expect(paths.repo).toBe("/root/.wt/app.toml");
  });
});
