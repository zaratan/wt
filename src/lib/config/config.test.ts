import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  loadConfig,
  configPaths,
  withGeneratedLayer,
  type LoadedConfig,
} from "./load.js";
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

  it("warns about an invalid delete_branch and ignores it, rather than failing", () => {
    const result = validateConfig({ remove: { delete_branch: "nope" } }, "x");
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.parsed.config.remove?.deleteBranch).toBeUndefined();
    expect(
      result.parsed.warnings.map((one) => one.message).join(" "),
    ).toContain("delete_branch");
  });

  it("leaves a key the file never mentions undefined, so lower layers survive", () => {
    const result = validateConfig({ schema: 1 }, "x");
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.parsed.config.remove?.deleteBranch).toBeUndefined();
    expect(result.parsed.config.provision?.timeoutMs).toBeUndefined();
    expect(result.parsed.config.provision?.copy).toBeUndefined();
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

describe("withGeneratedLayer", () => {
  const base: LoadedConfig = {
    config: DEFAULT_CONFIG,
    sources: [],
    warnings: [],
    needsInit: true,
  };

  it("lets the generated file win, because it is the layer that will land", () => {
    const folded = withGeneratedLayer(
      base,
      'schema = 1\n[space]\nlayout = "(@parent:claude | @wt:pnpm dev)"\n[repo]\ndefault_base = "develop"\n',
      "/x/.wt/app.toml",
    );

    if (folded.kind !== "ok") throw new Error(folded.message);
    expect(folded.loaded.config.space.layout).toBe(
      "(@parent:claude | @wt:pnpm dev)",
    );
    expect(folded.loaded.config.repo.defaultBase).toBe("develop");
  });

  it("keeps what the generated file does not mention", () => {
    const withGlobal: LoadedConfig = {
      ...base,
      config: {
        ...DEFAULT_CONFIG,
        remove: { deleteBranch: "always" },
      },
    };

    const folded = withGeneratedLayer(
      withGlobal,
      'schema = 1\n[space]\nlayout = "(@wt)"\n',
      "/x/.wt/app.toml",
    );

    if (folded.kind !== "ok") throw new Error(folded.message);
    expect(folded.loaded.config.remove.deleteBranch).toBe("always");
  });

  it("refuses a generated file from a newer schema rather than guessing", () => {
    const folded = withGeneratedLayer(base, "schema = 99\n", "/x/.wt/app.toml");
    expect(folded.kind).toBe("error");
  });
});

describe("a value set once, in the layer where it belongs", () => {
  it("survives a repository file that never mentions it", async () => {
    const root = join(sandbox.root, "layered");
    const home = join(root, "home");
    await mkdir(join(home, ".config", "wt"), { recursive: true });
    await writeFile(
      join(home, ".config", "wt", "config.toml"),
      'schema = 1\n[remove]\ndelete_branch = "always"\n[provision]\ntimeout_ms = 42\n',
    );
    await mkdir(join(root, ".wt"), { recursive: true });
    await writeFile(
      join(root, ".wt", "app.toml"),
      'schema = 1\n[space]\nlayout = "(@wt)"\n',
    );

    const loaded = await loadConfig({ HOME: home }, root, "app");
    if (loaded.kind !== "ok") throw new Error(loaded.message);

    expect(loaded.loaded.config.remove.deleteBranch).toBe("always");
    expect(loaded.loaded.config.provision.timeoutMs).toBe(42);
    expect(loaded.loaded.config.space.layout).toBe("(@wt)");
  });
});
