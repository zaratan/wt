import { relative } from "node:path";
import type { DoctorReport } from "../commands/doctor.js";
import type { Topology, UmbrellaReason } from "../lib/git/topology.js";

const REASONS: Record<UmbrellaReason, string> = {
  "declared-parent": "the parent has a .wt/ directory",
  "declared-repo": "the repository has a .wt/ directory",
  "too-many-siblings": "the parent holds too many entries to be an umbrella",
  "parent-ignores-repo": "the parent is a repo that gitignores this one",
  answered: "you answered the question, and .wt/ now records it",
  undecided: "nothing decided it, and nobody could be asked: treated as plain",
  forced: "forced on the command line",
};

const label = (text: string): string => text.padEnd(16);

const shorten = (path: string, base: string): string => {
  const rel = relative(base, path);
  return rel === "" ? "." : rel.startsWith("..") ? path : `./${rel}`;
};

const renderTopology = (topology: Topology, cwd: string): string[] => {
  const lines = [
    "Topology",
    `  ${label("repository")}${topology.repoRoot}`,
    `  ${label("name")}${topology.repoName}`,
    `  ${label("parent")}${topology.parent}${topology.parentIsRepo ? "  (a git repo)" : ""}`,
    `  ${label("umbrella")}${topology.umbrella}  — ${REASONS[topology.umbrellaReason]}`,
    `  ${label("@parent: opens")}${shorten(topology.contextRoot, cwd)}`,
    `  ${label("config in")}${shorten(topology.configRoot, cwd)}/.wt/`,
    `  ${label("worktrees in")}${topology.worktreesRoot}`,
  ];

  if (topology.startedInLinkedWorktree) {
    lines.push(`  ${label("note")}you are inside a linked worktree`);
  }

  const violated = topology.guards.filter((guard) => guard.violated);
  if (violated.length > 0) {
    lines.push("", "Blocking problems");
    for (const guard of violated) lines.push(`  ✗ ${guard.message}`);
  }

  return lines;
};

export const renderDoctor = (report: DoctorReport): string => {
  const lines: string[] = [
    "wt doctor",
    "",
    "Environment",
    `  ${label("working dir")}${report.cwd}`,
  ];

  lines.push(
    report.git.kind === "ok"
      ? `  ${label("git")}${report.git.version}`
      : `  ${label("git")}NOT USABLE — ${report.git.message}`,
  );

  lines.push(
    report.herdr.kind === "ok"
      ? `  ${label("herdr")}${report.herdr.version ?? "?"} on ${report.herdr.socketPath}`
      : `  ${label("herdr")}not answering — ${report.herdr.message}`,
  );
  if (report.herdr.kind === "ok" && report.herdr.capabilities.length > 0) {
    lines.push(
      `  ${label("")}capabilities: ${report.herdr.capabilities.join(", ")}`,
    );
  }

  if (report.herdr.kind === "down") {
    for (const path of report.herdr.triedPaths) {
      lines.push(`  ${label("")}tried ${path}`);
    }
  }

  if (report.inheritedGitVars.length > 0) {
    lines.push(
      `  ${label("inherited")}${report.inheritedGitVars.join(", ")} — stripped by wt, but other tools in this shell will follow them`,
    );
  }

  lines.push("");

  if (report.topology === undefined) {
    lines.push("Topology", "  skipped: git is not usable");
    return `${lines.join("\n")}\n`;
  }

  if (report.topology.kind === "error") {
    lines.push(
      "Topology",
      `  unresolved (${report.topology.code})`,
      `  ${report.topology.message}`,
    );
    return `${lines.join("\n")}\n`;
  }

  lines.push(...renderTopology(report.topology.topology, report.cwd));
  return `${lines.join("\n")}\n`;
};
