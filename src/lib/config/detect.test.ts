import { describe, it, expect } from "vitest";
import { classifyIgnored, type FileProbe } from "./detect.js";

const small: FileProbe = {
  exists: () => Promise.resolve(true),
  readJson: () => Promise.resolve(null),
  isExecutable: () => Promise.resolve(false),
  measure: () => Promise.resolve({ entries: 2, bytes: 100 }),
};

const huge: FileProbe = {
  ...small,
  measure: () => Promise.resolve({ entries: 1268, bytes: 100 }),
};

const classify = (path: string, probe = small) =>
  classifyIgnored(path, probe, `/repo/${path}`);

describe("classifyIgnored", () => {
  it("keeps a .env", async () => {
    expect((await classify(".env"))?.path).toBe(".env");
  });

  it("keeps a directory git reported with a trailing slash", async () => {
    expect((await classify("apps/web/certificates/"))?.path).toBe(
      "apps/web/certificates",
    );
  });

  it("keeps a Rails master key and credentials", async () => {
    expect(await classify("config/master.key")).toBeDefined();
    expect(await classify("config/credentials/production.key")).toBeDefined();
  });

  it("rejects an example file, which is tracked anyway", async () => {
    expect(await classify(".env.example")).toBeUndefined();
    expect(await classify(".env.sample")).toBeUndefined();
  });

  it("rejects build output and caches outright", async () => {
    for (const path of [
      "node_modules",
      "node_modules/.env",
      ".next",
      "coverage",
      "apps/web/dist",
      ".DS_Store",
    ]) {
      expect(await classify(path), path).toBeUndefined();
    }
  });

  it("rejects anything that is not a secret", async () => {
    expect(await classify("apps/web/next-env.d.ts")).toBeUndefined();
  });

  it("holds back a directory too big to copy blindly", async () => {
    const held = await classify("apps/web/certificates/", huge);
    expect(held?.held).toContain("1268 entries");
  });
});
