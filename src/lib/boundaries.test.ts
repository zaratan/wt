import { describe, it, expect, afterEach } from "vitest";
import { ESLint } from "eslint";
import { writeFile, rm, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

const ROOT = new URL("../..", import.meta.url).pathname;

const probes: string[] = [];

afterEach(async () => {
  await Promise.all(probes.splice(0).map((p) => rm(p, { force: true })));
});

const rulesFiredAt = async (
  relativePath: string,
  source: string,
): Promise<string[]> => {
  const absolute = join(ROOT, relativePath);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, source);
  probes.push(absolute);

  const eslint = new ESLint({ cwd: ROOT });
  const [result] = await eslint.lintFiles([absolute]);
  return (result?.messages ?? [])
    .map((m) => m.ruleId)
    .filter((id): id is string => id !== null);
};

const RESTRICTED_IMPORTS = "no-restricted-imports";
const RESTRICTED_PROPERTIES = "no-restricted-properties";

describe("architecture boundaries", () => {
  describe("sub-process spawning", () => {
    it("bans node:child_process outside lib/exec/", async () => {
      const fired = await rulesFiredAt(
        "src/lib/git/__probe_spawn.ts",
        `import { spawn } from "node:child_process";\nexport const x = spawn;\n`,
      );
      expect(fired).toContain(RESTRICTED_IMPORTS);
    });

    it("allows it inside lib/exec/, which owns the bottleneck", async () => {
      const fired = await rulesFiredAt(
        "src/lib/exec/__probe_spawn.ts",
        `import { spawn } from "node:child_process";\nexport const x = spawn;\n`,
      );
      expect(fired).not.toContain(RESTRICTED_IMPORTS);
    });

    it("bans it in commands/, where the ink probe alone would not notice", async () => {
      const fired = await rulesFiredAt(
        "src/commands/__probe_spawn.ts",
        `import { spawn } from "node:child_process";\nexport const x = spawn;\n`,
      );
      expect(fired).toContain(RESTRICTED_IMPORTS);
    });

    it("bans it in ui/, the layer most tempted to reach for it", async () => {
      const fired = await rulesFiredAt(
        "src/ui/__probe_spawn.ts",
        `import { spawn } from "node:child_process";\nexport const x = spawn;\n`,
      );
      expect(fired).toContain(RESTRICTED_IMPORTS);
    });

    it("bans it in format/, which only ever formats", async () => {
      const fired = await rulesFiredAt(
        "src/format/__probe_spawn.ts",
        `import { spawn } from "node:child_process";\nexport const x = spawn;\n`,
      );
      expect(fired).toContain(RESTRICTED_IMPORTS);
    });
  });

  describe("ambient process state", () => {
    it("bans process.cwd() outside index.tsx", async () => {
      const fired = await rulesFiredAt(
        "src/lib/git/__probe_cwd.ts",
        `export const here = (): string => process.cwd();\n`,
      );
      expect(fired).toContain(RESTRICTED_PROPERTIES);
    });

    it("bans process.env outside index.tsx and lib/exec/env.ts", async () => {
      const fired = await rulesFiredAt(
        "src/commands/__probe_env.ts",
        `export const home = (): string | undefined => process.env.HOME;\n`,
      );
      expect(fired).toContain(RESTRICTED_PROPERTIES);
    });
  });

  describe("UI-free layers", () => {
    it("bans a RELATIVE ui/ import, which the qualified glob alone misses", async () => {
      const fired = await rulesFiredAt(
        "src/lib/git/__probe_relative_ui.ts",
        `import { App } from "../../ui/App.js";\nexport const x = App;\n`,
      );
      expect(fired).toContain(RESTRICTED_IMPORTS);
    });

    it("bans ink from cli/, so dispatch can never render escape codes into --json", async () => {
      const fired = await rulesFiredAt(
        "src/cli/__probe_ink.ts",
        `import { Box } from "ink";\nexport const x = Box;\n`,
      );
      expect(fired).toContain(RESTRICTED_IMPORTS);
    });

    it("allows ink in ui/, which is the whole point of the layer", async () => {
      const fired = await rulesFiredAt(
        "src/ui/__probe_ink.ts",
        `import { Box } from "ink";\nexport const x = Box;\n`,
      );
      expect(fired).not.toContain(RESTRICTED_IMPORTS);
    });

    it("bans ink from commands/", async () => {
      const fired = await rulesFiredAt(
        "src/commands/__probe_ink.ts",
        `import { Box } from "ink";\nexport const x = Box;\n`,
      );
      expect(fired).toContain(RESTRICTED_IMPORTS);
    });

    it("bans react from lib/", async () => {
      const fired = await rulesFiredAt(
        "src/lib/__probe_react.ts",
        `import { useState } from "react";\nexport const x = useState;\n`,
      );
      expect(fired).toContain(RESTRICTED_IMPORTS);
    });
  });

  describe("format/ purity", () => {
    it("bans node:fs", async () => {
      const fired = await rulesFiredAt(
        "src/format/__probe_fs.ts",
        `import { readFileSync } from "node:fs";\nexport const x = readFileSync;\n`,
      );
      expect(fired).toContain(RESTRICTED_IMPORTS);
    });

    it("allows node:path, the documented exception", async () => {
      const fired = await rulesFiredAt(
        "src/format/__probe_path.ts",
        `import { basename } from "node:path";\nexport const x = basename;\n`,
      );
      expect(fired).not.toContain(RESTRICTED_IMPORTS);
    });
  });
});
