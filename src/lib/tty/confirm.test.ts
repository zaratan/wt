import { describe, it, expect } from "vitest";
import { Readable, Writable } from "node:stream";
import { askConfirm } from "./confirm.js";

const answering = (typed: string | undefined): Promise<boolean> => {
  const input = Readable.from(typed === undefined ? [] : [typed]);
  const output = new Writable({
    write(_chunk, _encoding, done) {
      done();
    },
  });
  return askConfirm({ input, output }, "go ahead?");
};

describe("askConfirm", () => {
  it("accepts the short and long yes, in both languages", async () => {
    expect(await answering("y\n")).toBe(true);
    expect(await answering("YES\n")).toBe(true);
    expect(await answering("oui\n")).toBe(true);
  });

  it("reads a bare newline as no, so nothing agrees by accident", async () => {
    expect(await answering("\n")).toBe(false);
  });

  it("reads anything else as no", async () => {
    expect(await answering("maybe\n")).toBe(false);
  });

  it("answers no on Ctrl-D instead of waiting forever", async () => {
    const answer = await Promise.race([
      answering(undefined),
      new Promise((resolve) =>
        setTimeout(() => {
          resolve("hung");
        }, 1_500),
      ),
    ]);
    expect(answer).toBe(false);
  });
});
