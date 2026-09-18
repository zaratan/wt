import { basename } from "node:path";
import type { StatusResult, WorktreeDetail } from "../commands/status.js";
import type { WorktreeStatus } from "../lib/git/status.js";

const label = (text: string): string => text.padEnd(14);

const unpublishedLines = (status: WorktreeStatus): string[] => {
  const { unpublished } = status;
  switch (unpublished.kind) {
    case "unborn":
      return [`  ${label("commits")}no commit yet`];
    case "no-remote":
      return [
        `  ${label("commits")}${String(unpublished.count)} local, and no remote is configured — nothing has ever been published`,
      ];
    case "unknown":
      return [];
    case "count": {
      if (unpublished.count === 0) {
        return [`  ${label("commits")}all published`];
      }
      const age =
        status.remoteRefAge === undefined
          ? ""
          : `  (freshest remote ref: ${status.remoteRefAge})`;
      return [
        `  ${label("commits")}${String(unpublished.count)} unpublished${age}`,
        ...unpublished.sample.map((line) => `                ${line}`),
      ];
    }
  }
};

const provisionLines = (detail: WorktreeDetail): string[] => {
  if (detail.status.isMain) return [];

  const { state, failedStep } = detail.state.provision;
  if (state === "never") return [`  ${label("provision")}never run`];
  const suffix = failedStep === undefined ? "" : ` at step: ${failedStep}`;
  const lines = [`  ${label("provision")}${state}${suffix}`];
  if (state === "failed" || state === "interrupted") {
    lines.push(
      `                replay it with \`wt provision ${
        detail.status.branch ?? detail.status.path
      }\``,
    );
  }
  return lines;
};

const spaceLines = (detail: WorktreeDetail): string[] => {
  if (detail.space === undefined) return [];
  const name =
    detail.space.label === undefined ? "" : ` (${detail.space.label})`;
  return [
    `  ${label("space")}${detail.space.focused ? "focused" : "open"}${name}`,
  ];
};

const renderOne = (detail: WorktreeDetail): string[] => {
  const status = detail.status;
  const lines = [
    basename(status.path),
    `  ${label("path")}${status.path}`,
    `  ${label("branch")}${status.detached ? "(detached)" : (status.branch ?? "(none)")}`,
    `  ${label("managed")}${status.isMain ? "main checkout" : status.managed ? "yes" : "no — created outside wt"}`,
  ];

  if (status.missing) {
    lines.push(`  ${label("state")}DIRECTORY MISSING`);
    return lines;
  }
  if (status.prunable) lines.push(`  ${label("state")}prunable`);
  if (status.operation !== undefined) {
    lines.push(`  ${label("state")}${status.operation} in progress`);
  }

  lines.push(
    `  ${label("working tree")}${
      status.modified === 0 && status.untracked === 0
        ? "clean"
        : `${String(status.modified)} modified, ${String(status.untracked)} untracked`
    }`,
    ...unpublishedLines(status),
    ...provisionLines(detail),
    ...spaceLines(detail),
  );
  return lines;
};

export const renderStatus = (result: StatusResult): string => {
  if (result.kind === "choose") {
    return [
      `Several repositories live under ${result.from}:`,
      "",
      ...result.candidates.map((candidate) => `  ${candidate.name}`),
      "",
    ].join("\n");
  }
  if (result.kind === "error") {
    return [
      `wt status: ${result.message}`,
      ...(result.hint === undefined ? [] : [`  ${result.hint}`]),
      "",
    ].join("\n");
  }

  const blocks = result.report.details.map((detail) =>
    renderOne(detail).join("\n"),
  );
  const unavailable = result.report.spaces.unavailable;
  const tail =
    unavailable === undefined
      ? ""
      : `\n\n  herdr not reachable, spaces unknown: ${unavailable}`;
  return `${blocks.join("\n\n")}${tail}\n`;
};
