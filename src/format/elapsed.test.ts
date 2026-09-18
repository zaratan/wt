import { describe, it, expect } from "vitest";
import { elapsed } from "./elapsed.js";

describe("elapsed", () => {
  it("counts seconds under a minute", () => {
    expect(elapsed(0)).toBe("0 s");
    expect(elapsed(41_400)).toBe("41 s");
  });

  it("splits minutes and seconds beyond that", () => {
    expect(elapsed(72_000)).toBe("1 min 12 s");
    expect(elapsed(600_000)).toBe("10 min 0 s");
  });

  it("never shows a negative clock when the timer races the start", () => {
    expect(elapsed(-5_000)).toBe("0 s");
  });
});
