import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { Confirm } from "./Confirm.js";

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 80));

describe("Confirm", () => {
  it("shows every line of a multi-line question", () => {
    const frame =
      render(
        <Confirm question={"first line\nsecond line"} onAnswer={vi.fn()} />,
      ).lastFrame() ?? "";
    expect(frame).toContain("first line");
    expect(frame).toContain("second line");
  });

  it("answers yes on y, in both languages", async () => {
    for (const key of ["y", "o"]) {
      const onAnswer = vi.fn();
      const { stdin } = render(
        <Confirm question="go ahead?" onAnswer={onAnswer} />,
      );
      stdin.write(key);
      await settle();
      expect(onAnswer).toHaveBeenCalledWith(true);
    }
  });

  it("reads a bare enter as no, so nothing agrees by accident", async () => {
    const onAnswer = vi.fn();
    const { stdin } = render(
      <Confirm question="go ahead?" onAnswer={onAnswer} />,
    );
    stdin.write("\r");
    await settle();
    expect(onAnswer).toHaveBeenCalledWith(false);
  });

  it("reads escape as no", async () => {
    const onAnswer = vi.fn();
    const { stdin } = render(
      <Confirm question="go ahead?" onAnswer={onAnswer} />,
    );
    stdin.write("\x1b");
    await settle();
    expect(onAnswer).toHaveBeenCalledWith(false);
  });
});
