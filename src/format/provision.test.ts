import { describe, it, expect } from "vitest";
import { provisionLines, renderProvision } from "./provision.js";
import type { ProvisionReport } from "../lib/provision/run.js";

const reportWith = (
  outcome: ProvisionReport["commands"][number]["outcome"],
): ProvisionReport => ({
  copies: [],
  commands: [{ run: "pnpm install", outcome }],
  ok: outcome === "ran" || outcome === "skipped",
  logPath: "/tmp/wt.log",
});

describe("provisionLines", () => {
  it("names every outcome, so none can vanish from the report", () => {
    const outcomes = [
      "ran",
      "skipped",
      "failed",
      "timed-out",
      "interrupted",
    ] as const;
    for (const outcome of outcomes) {
      expect(provisionLines(reportWith(outcome)).join(" ")).toContain(
        "pnpm install",
      );
    }
  });

  it("says a run was interrupted rather than calling it a failure", () => {
    expect(renderProvision(reportWith("interrupted"))).toContain(
      "Provisioning interrupted.",
    );
    expect(renderProvision(reportWith("failed"))).toContain(
      "Provisioning failed.",
    );
  });
});
