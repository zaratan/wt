import { describe, it, expect } from "vitest";
import { createRing } from "./ring.js";

describe("createRing", () => {
  it("rejects a limit below 1", () => {
    expect(() => createRing(0)).toThrow(RangeError);
  });

  it("keeps complete lines in order", () => {
    const ring = createRing(10);
    ring.push("a\nb\nc\n");
    expect(ring.lines()).toEqual(["a", "b", "c"]);
  });

  it("drops the oldest lines past the limit", () => {
    const ring = createRing(2);
    ring.push("a\nb\nc\nd\n");
    expect(ring.lines()).toEqual(["c", "d"]);
    expect(ring.totalLines()).toBe(4);
  });

  it("reassembles a line split across chunks", () => {
    const ring = createRing(10);
    ring.push("hel");
    ring.push("lo wor");
    ring.push("ld\n");
    expect(ring.lines()).toEqual(["hello world"]);
  });

  it("surfaces a trailing line that has no newline yet", () => {
    const ring = createRing(10);
    ring.push("done\nin prog");
    expect(ring.lines()).toEqual(["done", "in prog"]);
    expect(ring.totalLines()).toBe(2);
  });

  it("does not count a pending line twice once it completes", () => {
    const ring = createRing(10);
    ring.push("partial");
    expect(ring.totalLines()).toBe(1);
    ring.push("\n");
    expect(ring.totalLines()).toBe(1);
    expect(ring.lines()).toEqual(["partial"]);
  });

  it("preserves empty lines", () => {
    const ring = createRing(10);
    ring.push("a\n\nb\n");
    expect(ring.lines()).toEqual(["a", "", "b"]);
  });

  it("returns a copy, so callers cannot corrupt the window", () => {
    const ring = createRing(10);
    ring.push("a\n");
    ring.lines().push("injected");
    expect(ring.lines()).toEqual(["a"]);
  });
});
