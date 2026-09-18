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

  it("answers yes only on an explicit y", async () => {
    for (const key of ["y", "Y"]) {
      const onAnswer = vi.fn();
      const { stdin } = render(
        <Confirm question="go ahead?" onAnswer={onAnswer} />,
      );
      stdin.write(key);
      await settle();
      expect(onAnswer).toHaveBeenCalledWith(true);
    }
  });

  it("does not bind enter at all: it means yes on every other screen", async () => {
    const onAnswer = vi.fn();
    const { stdin } = render(
      <Confirm question="go ahead?" onAnswer={onAnswer} />,
    );
    stdin.write("\r");
    await settle();
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it("answers no on n and on q", async () => {
    for (const key of ["n", "q"]) {
      const onAnswer = vi.fn();
      const { stdin } = render(
        <Confirm question="go ahead?" onAnswer={onAnswer} />,
      );
      stdin.write(key);
      await settle();
      expect(onAnswer).toHaveBeenCalledWith(false);
    }
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
