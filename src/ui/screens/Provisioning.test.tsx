import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { Provisioning, type Subscribe } from "./Provisioning.js";
import type { ProvisionEvent } from "../../lib/provision/run.js";

const title = {
  repoName: "konnect",
  branch: "feat/x",
  steps: ["bundle install", "bin/setup"],
  logPath: "/tmp/wt.log",
};

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 80));

const feed = (): {
  subscribe: Subscribe;
  emit: (event: ProvisionEvent) => void;
} => {
  const listeners = new Set<(event: ProvisionEvent) => void>();
  return {
    subscribe: (listen) => {
      listeners.add(listen);
      return () => listeners.delete(listen);
    },
    emit: (event) => {
      for (const listen of listeners) listen(event);
    },
  };
};

describe("Provisioning", () => {
  it("lists every step up front, so `of how many` is visible", () => {
    const { subscribe } = feed();
    const frame =
      render(
        <Provisioning title={title} subscribe={subscribe} />,
      ).lastFrame() ?? "";
    expect(frame).toContain("bundle install");
    expect(frame).toContain("bin/setup");
    expect(frame).toContain("/tmp/wt.log");
  });

  it("marks a finished step and moves the cursor to the next", async () => {
    const { subscribe, emit } = feed();
    const { lastFrame } = render(
      <Provisioning title={title} subscribe={subscribe} />,
    );

    emit({ kind: "step-start", run: "bundle install", index: 0, total: 2 });
    emit({ kind: "step-done", run: "bundle install", outcome: "ran" });
    await settle();

    const frame = lastFrame() ?? "";
    expect(frame).toContain("✓ bundle install");
    expect(frame).toContain("▸ bin/setup");
  });

  it("shows one tail line, not a scrolling wall", async () => {
    const { subscribe, emit } = feed();
    let clock = 0;
    const { lastFrame } = render(
      <Provisioning
        title={title}
        subscribe={subscribe}
        now={() => (clock += 1_000)}
      />,
    );

    emit({ kind: "output", line: "resolving one" });
    emit({ kind: "output", line: "resolving two" });
    await settle();

    const frame = lastFrame() ?? "";
    expect(frame).toContain("resolving two");
    expect(frame).not.toContain("resolving one");
  });

  it("drops repaints that arrive faster than the throttle", async () => {
    const { subscribe, emit } = feed();
    const { lastFrame } = render(
      <Provisioning title={title} subscribe={subscribe} now={() => 1_000} />,
    );

    emit({ kind: "output", line: "first" });
    emit({ kind: "output", line: "second" });
    await settle();

    expect(lastFrame() ?? "").toContain("first");
  });

  it("counts the files it copied", async () => {
    const { subscribe, emit } = feed();
    const { lastFrame } = render(
      <Provisioning title={title} subscribe={subscribe} />,
    );

    emit({ kind: "copy", path: ".env", outcome: "copied" });
    emit({ kind: "copy", path: "missing", outcome: "missing" });
    await settle();

    expect(lastFrame() ?? "").toContain("copied 1 file(s)");
  });

  it("never offers a key while it is running", () => {
    const { subscribe } = feed();
    const frame =
      render(
        <Provisioning title={title} subscribe={subscribe} />,
      ).lastFrame() ?? "";
    expect(frame).not.toContain("esc");
    expect(frame).not.toContain("enter");
  });
});
