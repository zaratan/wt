import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { NewBranch } from "./NewBranch.js";

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 80));

describe("NewBranch", () => {
  it("shows the directory the name will produce", async () => {
    const { stdin, lastFrame } = render(
      <NewBranch repoName="wt" onSubmit={vi.fn()} onCancel={vi.fn()} />,
    );

    stdin.write("feat/x");
    await settle();
    expect(lastFrame() ?? "").toContain("directory  feat-x");
  });

  it("submits the typed branch", async () => {
    const onSubmit = vi.fn();
    const { stdin } = render(
      <NewBranch repoName="wt" onSubmit={onSubmit} onCancel={vi.fn()} />,
    );

    stdin.write("feat/x");
    await settle();
    stdin.write("\r");
    await settle();
    expect(onSubmit).toHaveBeenCalledWith("feat/x");
  });

  it("refuses to submit a name with no usable directory form", async () => {
    const onSubmit = vi.fn();
    const { stdin, lastFrame } = render(
      <NewBranch repoName="wt" onSubmit={onSubmit} onCancel={vi.fn()} />,
    );

    stdin.write("///");
    await settle();
    expect(lastFrame() ?? "").toContain("no usable directory form");
    stdin.write("\r");
    await settle();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits nothing on an empty name", async () => {
    const onSubmit = vi.fn();
    const { stdin } = render(
      <NewBranch repoName="wt" onSubmit={onSubmit} onCancel={vi.fn()} />,
    );

    stdin.write("\r");
    await settle();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("cancels on escape", async () => {
    const onCancel = vi.fn();
    const { stdin } = render(
      <NewBranch repoName="wt" onSubmit={vi.fn()} onCancel={onCancel} />,
    );

    stdin.write("\x1b");
    await settle();
    expect(onCancel).toHaveBeenCalled();
  });
});
