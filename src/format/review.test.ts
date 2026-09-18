import { describe, it, expect } from "vitest";
import { reviewGroups, detectedSummary } from "./review.js";
import { applyDecision, initialSelection } from "../lib/config/review.js";
import type { Detected } from "../lib/config/detect.js";

const detected: Detected = {
  installCommand: "bundle install",
  devCommand: "bin/dev",
  defaultBase: "develop",
  remote: "origin",
  copy: [
    { path: ".env", reason: "ignored, and the repo expects it" },
    { path: "apps/web/.env", reason: "ignored, and the repo expects it" },
    { path: "config/master.key", reason: "Rails master key" },
    { path: "storage/", reason: "credentials", held: "412 entries, 23841 KiB" },
  ],
  notes: [],
};

describe("reviewGroups", () => {
  it("gathers repeated reasons under one heading instead of per line", () => {
    const groups = reviewGroups(detected);
    const env = groups.find((group) =>
      group.reason.startsWith("ignored, and the repo"),
    );
    expect(env?.entries.map((one) => one.path)).toEqual([
      ".env",
      "apps/web/.env",
    ]);
  });

  it("puts the entries held for their size last, under their own heading", () => {
    const groups = reviewGroups(detected);
    const last = groups.at(-1);
    expect(last?.held).toBe(true);
    expect(last?.reason).not.toContain("credentials");
    expect(last?.entries[0]?.measure).toBe("412 entries, 23841 KiB");
  });

  it("does not colour a held entry as a warning: nothing is going wrong", () => {
    expect(reviewGroups(detected).every((group) => "held" in group)).toBe(true);
  });
});

describe("detectedSummary", () => {
  it("shows the guesses that cost minutes, before the copy list", () => {
    expect(detectedSummary(detected).map((one) => one.label)).toEqual([
      "install",
      "dev",
      "base",
      "remote",
    ]);
  });

  it("leaves out what was not detected rather than printing a blank", () => {
    expect(detectedSummary({ copy: [], notes: [] })).toEqual([]);
  });
});

describe("the decision", () => {
  it("starts with everything but the entries held for their size", () => {
    expect(initialSelection(detected)).toEqual([
      ".env",
      "apps/web/.env",
      "config/master.key",
    ]);
  });

  it("keeps only what was selected, resolved by path", () => {
    const applied = applyDecision(detected, [".env", "config/master.key"]);
    expect(applied.copy.map((one) => one.path)).toEqual([
      ".env",
      "config/master.key",
    ]);
  });

  it("clears the held mark when the user opts a big entry in", () => {
    const applied = applyDecision(detected, ["storage/"]);
    expect(applied.copy[0]?.held).toBeUndefined();
  });
});
