import { describe, it, expect } from "vitest";
import { worktreeAddArgs } from "./worktree.js";

describe("worktreeAddArgs", () => {
  it("refuses the upstream git would hand a new branch from a remote base", () => {
    const args = worktreeAddArgs(
      { kind: "create", branch: "feat/x", base: "origin/develop" },
      "/w/feat-x",
    );

    expect(args).toContain("--no-track");
    expect(args).not.toContain("--track");
  });

  it("still tracks a branch the remote already has", () => {
    const args = worktreeAddArgs(
      { kind: "track-remote", branch: "feature/extra", remote: "origin" },
      "/w/feature-extra",
    );

    expect(args).toContain("--track");
    expect(args).toContain("origin/feature/extra");
  });

  it("asks for nothing special when the branch is already local", () => {
    const args = worktreeAddArgs(
      { kind: "checkout-local", branch: "feat/x" },
      "/w/feat-x",
    );

    expect(args).not.toContain("--track");
    expect(args).not.toContain("--no-track");
    expect(args).not.toContain("-b");
  });
});
