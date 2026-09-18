import { describe, it, expect } from "vitest";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonical } from "../lib/fs/canonical.js";

describe("canonical", () => {
  it("resolves the spelling macOS actually uses for /tmp", async () => {
    const dir = await mkdtemp(join(tmpdir(), "wt-canon-"));
    try {
      expect(await canonical(dir)).toBe(await realpath(dir));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("gives a path that does not exist back unchanged, rather than failing", async () => {
    expect(await canonical("/no/such/path/anywhere")).toBe(
      "/no/such/path/anywhere",
    );
  });
});
