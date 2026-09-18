import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { PickRepo } from "./PickRepo.js";
import type { RepoChoice } from "../../lib/git/resolve.js";

const choice: RepoChoice = {
  from: "/Users/zaratan/Projects/tercio",
  candidates: [
    { name: "tercioapp", path: "/Users/zaratan/Projects/tercio/tercioapp" },
    { name: "notes", path: "/Users/zaratan/Projects/tercio/notes" },
    { name: "platform", path: "/Users/zaratan/Projects/tercio/platform" },
  ],
};

// Arrow and escape sequences need a tick to be decoded; chaining keypresses
// without this settle loses every one after the first.
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 80));

describe("PickRepo", () => {
  it("lists every candidate, in the order it was given", () => {
    const { lastFrame } = render(<PickRepo choice={choice} onPick={vi.fn()} />);
    const frame = lastFrame() ?? "";

    expect(frame).toContain("tercioapp");
    expect(frame).toContain("notes");
    expect(frame.indexOf("tercioapp")).toBeLessThan(frame.indexOf("notes"));
  });

  it("answers with the absolute path, never the bare name", async () => {
    const onPick = vi.fn();
    const { stdin } = render(<PickRepo choice={choice} onPick={onPick} />);

    stdin.write("\r");
    await settle();
    expect(onPick).toHaveBeenCalledWith(
      "/Users/zaratan/Projects/tercio/tercioapp",
    );
  });

  it("moves down and picks the second candidate", async () => {
    const onPick = vi.fn();
    const { stdin } = render(<PickRepo choice={choice} onPick={onPick} />);

    stdin.write("\x1b[B");
    await settle();
    stdin.write("\r");
    await settle();
    expect(onPick).toHaveBeenCalledWith("/Users/zaratan/Projects/tercio/notes");
  });

  it("wraps from the first entry to the last", async () => {
    const onPick = vi.fn();
    const { stdin } = render(<PickRepo choice={choice} onPick={onPick} />);

    stdin.write("\x1b[A");
    await settle();
    stdin.write("\r");
    await settle();
    expect(onPick).toHaveBeenCalledWith(
      "/Users/zaratan/Projects/tercio/platform",
    );
  });

  it("answers undefined on escape, which leaves the command on its text path", async () => {
    const onPick = vi.fn();
    const { stdin } = render(<PickRepo choice={choice} onPick={onPick} />);

    stdin.write("\x1b");
    await settle();
    expect(onPick).toHaveBeenCalledWith(undefined);
  });
});
