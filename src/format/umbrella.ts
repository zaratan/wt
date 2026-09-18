import { basename } from "node:path";

export const umbrellaQuestion = (parent: string, repoRoot: string): string =>
  [
    "",
    `wt cannot tell whether ${basename(parent)} is a workspace folder holding ${basename(repoRoot)},`,
    "or just the directory this repository happens to sit in.",
    "",
    `Answering yes puts .wt/ and the @parent: panes in ${parent};`,
    `answering no keeps everything inside ${repoRoot}.`,
    "",
    `Treat ${basename(parent)} as a workspace folder? [y/N]`,
  ].join("\n");
