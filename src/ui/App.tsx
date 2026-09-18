import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "ink";
import { Dashboard, type DashboardAction } from "./screens/Dashboard.js";
import { RemovePanel } from "./screens/RemovePanel.js";
import { actionContext } from "./session.js";
import { runLs } from "../commands/ls.js";
import { runOpen } from "../commands/open.js";
import { runRm, findings } from "../commands/rm.js";
import { configFor } from "../commands/provision.js";
import { worktreeRows, type WorktreeRow } from "../format/rows.js";
import { removalIntent, type RemovalIntent } from "../format/removal.js";
import { DEFAULT_CONFIG } from "../lib/config/schema.js";
import type { CommandContext } from "../commands/context.js";
import type { Topology } from "../lib/git/topology.js";

export type AppProps = {
  base: CommandContext;
  onLeave: (message?: string) => void;
};

type View =
  | { kind: "list" }
  | { kind: "removing"; intent: RemovalIntent }
  | { kind: "busy"; label: string };

export const App = ({ base, onLeave }: AppProps): React.JSX.Element | null => {
  const { exit } = useApp();
  const [rows, setRows] = useState<readonly WorktreeRow[]>([]);
  const [orphans, setOrphans] = useState<readonly string[]>([]);
  const [topology, setTopology] = useState<Topology | undefined>(undefined);
  const [unavailable, setUnavailable] = useState<string | undefined>(undefined);
  const [focused, setFocused] = useState(0);
  const [view, setView] = useState<View>({ kind: "busy", label: "loading" });

  // A ref, not state: state flips several awaits into an action, so two keys
  // in the same tick both pass a state-based guard and run twice.
  const running = useRef(false);

  const load = useCallback(async () => {
    const { context } = actionContext(base);
    const result = await runLs(
      { all: false },
      { ...context, options: { ...context.options, prune: false } },
    );
    if (result.kind !== "ok") {
      onLeave(result.kind === "error" ? result.message : undefined);
      exit();
      return;
    }
    const next = worktreeRows(
      result.report.worktrees,
      result.report.spaces,
      base.cwd,
    );
    setTopology(result.report.topology);
    setRows(next);
    setOrphans(result.report.orphans.map((one) => one.path));
    setUnavailable(result.report.spaces.unavailable);
    setFocused((at) => {
      const here = next.findIndex((row) => row.here);
      return here >= 0 ? here : Math.min(at, Math.max(next.length - 1, 0));
    });
    setView({ kind: "list" });
  }, [base, exit, onLeave]);

  useEffect(() => {
    let cancelled = false;
    void load().then(() => {
      if (cancelled) return;
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const act = (action: DashboardAction, row?: WorktreeRow): void => {
    if (running.current) return;

    if (action === "quit") {
      exit();
      return;
    }
    if (action === "refresh") {
      running.current = true;
      setView({ kind: "busy", label: "refreshing" });
      void load().finally(() => {
        running.current = false;
      });
      return;
    }
    if (row === undefined) return;

    if (action === "status") {
      onLeave();
      exit();
      return;
    }
    if (action === "open") {
      running.current = true;
      setView({ kind: "busy", label: `opening ${row.name}` });
      const { context } = actionContext(base);
      void runOpen(
        { target: row.status.branch ?? row.status.path, focus: true },
        context,
      ).finally(() => {
        running.current = false;
        exit();
      });
      return;
    }

    running.current = true;
    setView({ kind: "busy", label: "checking" });
    const { context } = actionContext(base);
    void (async () => {
      const loaded =
        topology === undefined ? undefined : await configFor(topology, context);
      const config = loaded?.kind === "ok" ? loaded.config : DEFAULT_CONFIG;
      setView({
        kind: "removing",
        intent: removalIntent(row, findings(row.status), config),
      });
      running.current = false;
    })();
  };

  const decide = (remove: boolean): void => {
    const current = view;
    if (current.kind !== "removing" || running.current) {
      setView({ kind: "list" });
      return;
    }
    if (!remove) {
      setView({ kind: "list" });
      return;
    }

    running.current = true;
    setView({ kind: "busy", label: `removing ${current.intent.row.name}` });
    const { context } = actionContext(base);
    void runRm(
      {
        target:
          current.intent.row.status.branch ?? current.intent.row.status.path,
        force: false,
        deleteBranch: current.intent.branchPlan === "deleted",
      },
      context,
    )
      .then(() => load())
      .finally(() => {
        running.current = false;
      });
  };

  if (view.kind === "removing") {
    return <RemovePanel intent={view.intent} onAnswer={decide} />;
  }

  return (
    <Dashboard
      repoName={topology?.repoName ?? ""}
      rows={rows}
      orphans={orphans}
      herdrUnavailable={unavailable}
      busy={view.kind === "busy" ? view.label : undefined}
      focused={focused}
      onFocus={setFocused}
      onAct={act}
    />
  );
};
