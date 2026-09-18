#!/usr/bin/env bun
import { render } from "ink";
import { App } from "./app.js";
import { APP_VERSION } from "./version.js";

// The only place that reads ambient process state. Everything downstream takes
// it as a parameter — that is what makes `--cwd` honest and the layers testable
// (enforced by no-restricted-properties in eslint.config.js).
const argv = process.argv.slice(2);
const cwd = process.cwd();

const HELP_TEXT = `wt — Git worktree manager integrated with herdr

  Options:
    --version, -V   Print the version
    --help, -h      Print this help
`;

if (argv.includes("--version") || argv.includes("-V")) {
  process.stdout.write(`wt ${APP_VERSION}\n`);
  process.exit(0);
}

if (argv.includes("--help") || argv.includes("-h")) {
  process.stdout.write(HELP_TEXT);
  process.exit(0);
}

if (!process.stdout.isTTY) {
  process.stderr.write(
    "wt needs an interactive terminal.\n(No TTY detected — output was probably redirected.)\n",
  );
  process.exit(1);
}

render(<App cwd={cwd} />);
