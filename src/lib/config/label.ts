import { basename } from "node:path";
import type { Topology } from "../git/topology.js";

export type LabelInput = {
  topology: Topology;
  branch: string;
  slug: string;
  as?: string;
};

const TOKEN = /\{(parent|repo|branch|slug|as)\}/g;

const defaultTemplate = (topology: Topology): string =>
  topology.umbrella === "umbrella" ? "{parent} - {as}" : "{repo} - {as}";

export const spaceLabel = (
  template: string | undefined,
  input: LabelInput,
): string => {
  const tokens: Record<string, string> = {
    parent: basename(input.topology.parent),
    repo: input.topology.repoName,
    branch: input.branch,
    slug: input.slug,
    as: input.as ?? input.branch.split("/").pop() ?? input.branch,
  };
  return (template ?? defaultTemplate(input.topology))
    .replace(TOKEN, (_match, key: string) => tokens[key] ?? "")
    .trim();
};
