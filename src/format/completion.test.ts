import { describe, it, expect } from "vitest";
import { zshCompletion } from "./completion.js";
import { COMMANDS, GLOBAL_OPTIONS } from "../cli/spec.js";

describe("zshCompletion", () => {
  const script = zshCompletion();

  it("declares itself for wt", () => {
    expect(script.startsWith("#compdef wt")).toBe(true);
  });

  it("offers every command and alias", () => {
    for (const command of COMMANDS) {
      expect(script, command.name).toContain(`'${command.name}:`);
      for (const alias of command.aliases ?? []) {
        expect(script, alias).toContain(`'${alias}:`);
      }
    }
  });

  it("offers every option of every command, so it cannot drift from the parser", () => {
    for (const command of COMMANDS) {
      for (const option of [...command.options, ...GLOBAL_OPTIONS]) {
        expect(script, `${command.name}/--${option.long}`).toContain(
          `--${option.long}[`,
        );
      }
    }
  });

  it("offers the negated form of a negatable option", () => {
    expect(script).toContain("--no-open[");
  });

  it("escapes a colon in help text, which would end the zsh spec early", () => {
    const descriptions = [...script.matchAll(/\[([^\]]*)\]/g)].map(
      (match) => match[1] ?? "",
    );
    const offending = descriptions.filter((text) => /(^|[^\\]):/.test(text));
    expect(offending).toEqual([]);
  });
});
