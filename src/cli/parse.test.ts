import { describe, it, expect } from "vitest";
import { parse, flag, value } from "./parse.js";
import type { ParseResult } from "./parse.js";

const run = (line: string): ParseResult =>
  parse(line.split(" ").filter(Boolean));

const asRun = (result: ParseResult) => {
  if (result.kind !== "run") {
    throw new Error(`expected a run, got ${result.kind}`);
  }
  return result.invocation;
};

describe("parse", () => {
  describe("help and version win wherever they appear", () => {
    it("treats --help as help rather than as a branch name to create", () => {
      expect(run("--help").kind).toBe("help");
      expect(run("-h").kind).toBe("help");
    });

    it("scopes --help to the command it follows", () => {
      const result = run("new --help");
      expect(result).toEqual({ kind: "help", topic: "new" });
    });

    it("answers --version before anything else", () => {
      expect(run("--version").kind).toBe("version");
      expect(run("new feat --version").kind).toBe("version");
    });

    it("handles `wt help <command>`", () => {
      expect(run("help new")).toEqual({ kind: "help", topic: "new" });
      expect(run("help")).toEqual({ kind: "help", topic: undefined });
    });
  });

  describe("unknown input is a hard error", () => {
    it("rejects an unknown option and lists what is accepted", () => {
      const result = run("new feat/x --nope");
      expect(result.kind).toBe("error");
      if (result.kind !== "error") throw new Error("expected error");
      expect(result.message).toContain("--nope");
      expect(result.hint).toContain("--as");
    });

    it("rejects an unknown command and lists the known ones", () => {
      const result = run("bogus");
      expect(result.kind).toBe("error");
      if (result.kind !== "error") throw new Error("expected error");
      expect(result.hint).toContain("new");
    });

    it("rejects a negation of a non-negatable option", () => {
      expect(run("new feat/x --no-as").kind).toBe("error");
    });

    it("rejects an option that is missing its value", () => {
      const result = run("new feat/x --as");
      expect(result.kind).toBe("error");
      if (result.kind !== "error") throw new Error("expected error");
      expect(result.message).toContain("--as");
    });

    it("does not swallow the next flag as a value", () => {
      expect(run("new feat/x --as --json").kind).toBe("error");
    });

    it("rejects a value on a boolean option", () => {
      expect(run("new feat/x --json=yes").kind).toBe("error");
    });
  });

  describe("positional resolution", () => {
    it("binds a lone value to the branch, not the repo", () => {
      const invocation = asRun(run("new investigations/import-cmdb"));
      expect(invocation.positionals.branch).toBe("investigations/import-cmdb");
      expect(invocation.positionals.repo).toBeUndefined();
    });

    it("binds two values as repo then branch", () => {
      const invocation = asRun(run("new tercioapp investigations/import-cmdb"));
      expect(invocation.positionals.repo).toBe("tercioapp");
      expect(invocation.positionals.branch).toBe("investigations/import-cmdb");
    });

    it("refuses a third positional", () => {
      const result = run("new a b c");
      expect(result.kind).toBe("error");
      if (result.kind !== "error") throw new Error("expected error");
      expect(result.message).toContain("too many");
    });

    it("reports a missing required positional", () => {
      const result = run("new");
      expect(result.kind).toBe("error");
      if (result.kind !== "error") throw new Error("expected error");
      expect(result.message).toContain("<branch>");
    });

    it("binds a lone value to the leading required slot, anchoring left", () => {
      const invocation = asRun(run("config show"));
      expect(invocation.positionals.action).toBe("show");
      expect(invocation.positionals.repo).toBeUndefined();
    });

    it("still binds both slots when given two values", () => {
      const invocation = asRun(run("config edit tercioapp"));
      expect(invocation.positionals.action).toBe("edit");
      expect(invocation.positionals.repo).toBe("tercioapp");
    });

    it("validates a constrained positional", () => {
      const result = run("config bogus");
      expect(result.kind).toBe("error");
      if (result.kind !== "error") throw new Error("expected error");
      expect(result.message).toContain("init, show, path, edit");
    });
  });

  describe("options", () => {
    it("accepts a value after a space", () => {
      const invocation = asRun(run("new feat/x --as CMDB"));
      expect(value(invocation.options, "as")).toBe("CMDB");
    });

    it("accepts a value with an equals sign", () => {
      const invocation = asRun(run("new feat/x --as=CMDB"));
      expect(value(invocation.options, "as")).toBe("CMDB");
    });

    it("accepts a value that looks like a flag, when inlined", () => {
      const invocation = asRun(run("new feat/x --as=--weird"));
      expect(value(invocation.options, "as")).toBe("--weird");
    });

    it("sets a negatable option to false via --no-", () => {
      const invocation = asRun(run("new feat/x --no-open"));
      expect(flag(invocation.options, "open", true)).toBe(false);
    });

    it("leaves an unsupplied option to its default", () => {
      const invocation = asRun(run("new feat/x"));
      expect(flag(invocation.options, "open", true)).toBe(true);
      expect(flag(invocation.options, "provision", true)).toBe(true);
    });

    it("accepts global options anywhere", () => {
      const invocation = asRun(run("--json new feat/x --verbose"));
      expect(flag(invocation.options, "json", false)).toBe(true);
      expect(flag(invocation.options, "verbose", false)).toBe(true);
    });

    it("accepts a short option", () => {
      const invocation = asRun(run("new feat/x -y"));
      expect(flag(invocation.options, "yes", false)).toBe(true);
    });
  });

  describe("the non-positional escape hatch", () => {
    it("accepts --repo and --branch instead of positionals", () => {
      const invocation = asRun(
        run("new --repo tercioapp --branch investigations/import-cmdb"),
      );
      expect(invocation.positionals.repo).toBe("tercioapp");
      expect(invocation.positionals.branch).toBe("investigations/import-cmdb");
    });

    it("refuses the same thing given twice", () => {
      const result = run("new tercioapp feat/x --repo other");
      expect(result.kind).toBe("error");
      if (result.kind !== "error") throw new Error("expected error");
      expect(result.message).toContain("given twice");
    });
  });

  describe("miscellaneous", () => {
    it("falls back to `ls` when invoked bare", () => {
      expect(asRun(run("")).spec.name).toBe("ls");
    });

    it("resolves an alias to its command", () => {
      expect(asRun(run("go feat/x")).spec.name).toBe("open");
      expect(asRun(run("remove feat/x")).spec.name).toBe("rm");
    });

    it("keeps everything after -- verbatim", () => {
      const invocation = asRun(
        parse(["new", "feat/x", "--", "--not-mine", "-q"]),
      );
      expect(invocation.rest).toEqual(["--not-mine", "-q"]);
      expect(invocation.positionals.branch).toBe("feat/x");
    });

    it("parses a nested action with its argument", () => {
      const invocation = asRun(parse(["layout", "check", "(@wt:shell)"]));
      expect(invocation.positionals.action).toBe("check");
      expect(invocation.positionals.dsl).toBe("(@wt:shell)");
    });
  });
});
