import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { ConfigReviewScreen } from "./ConfigReview.js";
import type { ConfigReview } from "../../lib/config/review.js";

const review: ConfigReview = {
  repoName: "konnect",
  path: "/Users/zaratan/Projects/konnect/.wt/konnect.toml",
  umbrella: "plain",
  umbrellaReason: "too-many-siblings",
  detected: {
    installCommand: "bundle install",
    devCommand: "bin/dev",
    defaultBase: "main",
    remote: "origin",
    copy: [
      { path: ".env", reason: "ignored, and the repo expects it" },
      { path: "config/master.key", reason: "Rails master key" },
      {
        path: "storage/",
        reason: "credentials",
        held: "412 entries, 23841 KiB",
      },
    ],
    notes: [],
  },
};

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 80));

describe("ConfigReviewScreen", () => {
  it("shows the expensive guesses above the copy list", () => {
    const frame =
      render(
        <ConfigReviewScreen review={review} onDecide={vi.fn()} />,
      ).lastFrame() ?? "";

    expect(frame).toContain("bundle install");
    expect(frame.indexOf("bundle install")).toBeLessThan(frame.indexOf(".env"));
  });

  it("starts with the big entry off and the others on", () => {
    const frame =
      render(
        <ConfigReviewScreen review={review} onDecide={vi.fn()} />,
      ).lastFrame() ?? "";

    expect(frame).toContain("[x] .env");
    expect(frame).toContain("[ ] storage/");
    expect(frame).toContain("412 entries");
  });

  it("writes the selection as paths, not as positions", async () => {
    const onDecide = vi.fn();
    const { stdin } = render(
      <ConfigReviewScreen review={review} onDecide={onDecide} />,
    );

    stdin.write("\r");
    await settle();
    expect(onDecide).toHaveBeenCalledWith({
      kind: "write",
      copy: [".env", "config/master.key"],
    });
  });

  it("drops an entry the user turns off", async () => {
    const onDecide = vi.fn();
    const { stdin } = render(
      <ConfigReviewScreen review={review} onDecide={onDecide} />,
    );

    stdin.write(" ");
    await settle();
    stdin.write("\r");
    await settle();
    expect(onDecide).toHaveBeenCalledWith({
      kind: "write",
      copy: ["config/master.key"],
    });
  });

  it("takes a big entry in when the user overrules the size", async () => {
    const onDecide = vi.fn();
    const { stdin } = render(
      <ConfigReviewScreen review={review} onDecide={onDecide} />,
    );

    for (let step = 0; step < 2; step += 1) {
      stdin.write("\x1b[B");
      await settle();
    }
    stdin.write(" ");
    await settle();
    stdin.write("\r");
    await settle();

    expect(onDecide).toHaveBeenCalledWith({
      kind: "write",
      copy: [".env", "config/master.key", "storage/"],
    });
  });

  it("skips on escape, which writes nothing at all", async () => {
    const onDecide = vi.fn();
    const { stdin } = render(
      <ConfigReviewScreen review={review} onDecide={onDecide} />,
    );

    stdin.write("\x1b");
    await settle();
    expect(onDecide).toHaveBeenCalledWith({ kind: "skip" });
  });

  it("says where the config will land and why", () => {
    const frame =
      render(
        <ConfigReviewScreen review={review} onDecide={vi.fn()} />,
      ).lastFrame() ?? "";
    expect(frame).toContain("stands alone");
  });
});
