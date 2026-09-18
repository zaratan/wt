import { describe, it, expect } from "vitest";
import { renderHelp, renderCommandHelp, renderIndex } from "./help.js";
import { COMMANDS, GLOBAL_OPTIONS, findCommand } from "./spec.js";

/** Lookup that fails the test instead of leaning on a non-null assertion. */
const spec = (name: string) => {
  const found = findCommand(name);
  if (found === undefined) throw new Error(`no such command: ${name}`);
  return found;
};

describe("help", () => {
  it("lists every command in the index, grouped by intent", () => {
    const text = renderIndex();
    for (const command of COMMANDS) {
      expect(text).toContain(command.name);
      expect(text).toContain(command.summary);
    }
    expect(text).toContain("Create:");
    expect(text).toContain("Clean up:");
  });

  it("documents every option of every command", () => {
    // Help is generated from the same table the parser reads, so an option
    // cannot exist without being documented. This is the assertion that keeps
    // it that way if the rendering ever changes.
    for (const command of COMMANDS) {
      const text = renderCommandHelp(command);
      for (const option of [...command.options, ...GLOBAL_OPTIONS]) {
        expect(text, `${command.name} / --${option.long}`).toContain(
          `--${option.long}`,
        );
      }
    }
  });

  it("shows the argument shape and at least one real example", () => {
    const text = renderCommandHelp(spec("new"));
    expect(text).toContain("wt new [repo] <branch> [options]");
    expect(text).toContain("wt new investigations/import-cmdb --as CMDB");
  });

  it("marks a negatable option with both forms", () => {
    const text = renderCommandHelp(spec("new"));
    expect(text).toContain("--open/--no-open");
  });

  it("spells out the choices of a constrained argument", () => {
    const text = renderCommandHelp(spec("config"));
    expect(text).toContain("init, show, path, edit");
  });

  it("mentions aliases when there are any", () => {
    const text = renderCommandHelp(spec("rm"));
    expect(text).toContain("Aliases: remove, del");
  });

  it("falls back to the index for an unknown topic", () => {
    const text = renderHelp("nope");
    expect(text).toContain("unknown command 'nope'");
    expect(text).toContain("Usage: wt <command>");
  });

  it("resolves a topic given by alias", () => {
    expect(renderHelp("go")).toContain("wt open");
  });

  it("gives every command a description that is not just its summary", () => {
    for (const command of COMMANDS) {
      expect(command.description.length).toBeGreaterThan(
        command.summary.length,
      );
    }
  });
});
