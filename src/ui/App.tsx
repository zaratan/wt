import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "ink";
import { Dashboard, type DashboardAction } from "./screens/Dashboard.js";
import { RemovePanel } from "./screens/RemovePanel.js";
import { NewBranch } from "./screens/NewBranch.js";
import { StatusView } from "./screens/StatusView.js";
import { Confirm } from "./screens/Confirm.js";
import { ConfigReviewScreen } from "./screens/ConfigReview.js";
import { Provisioning } from "./screens/Provisioning.js";
import { inAppResolvers, type Pending } from "./pending.js";
import { runAction } from "./session.js";
import { runLs } from "../commands/ls.js";
import { runOpen } from "../commands/open.js";
import { runNew } from "../commands/new.js";
import { runStatus } from "../commands/status.js";
import { runRm, findings } from "../commands/rm.js";
import { configFor } from "../commands/provision.js";
import { renderLs } from "../format/ls.js";
import { renderOpen } from "../format/open.js";
import { renderNew } from "../format/new.js";
import { renderRm } from "../format/rm.js";
import { renderStatus } from "../format/status.js";
import { worktreeRows, type WorktreeRow } from "../format/rows.js";
import { removalIntent, type RemovalIntent } from "../format/removal.js";
import { DEFAULT_CONFIG } from "../lib/config/schema.js";
import type { CommandContext } from "../commands/context.js";
import type { Topology } from "../lib/git/topology.js";

export type Leaving = { message?: string };

export type AppProps = {
  base: CommandContext;
  onLeave: (leaving: Leaving) => void;
};

type View =
  | { kind: "list" }
  | { kind: "creating" }
  | { kind: "showing"; text: string }
  | { kind: "removing"; intent: RemovalIntent }
  | { kind: "busy"; label: string };

export const App = ({ base, onLeave }: AppProps): React.JSX.Element | null => {
  const { exit } = useApp();
  const [rows, setRows] = useState<readonly WorktreeRow[]>([]);
  const [orphans, setOrphans] = useState<readonly string[]>([]);
  const [repos, setRepos] = useState(1);
  const [topology, setTopology] = useState<Topology | undefined>(undefined);
  const [unavailable, setUnavailable] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [focused, setFocused] = useState(0);
  const [view, setView] = useState<View>({ kind: "busy", label: "loading" });
  // A command running inside the TUI asks through here, so nothing ever mounts
  // a second Ink instance and nothing drops back to the text path.
  const [pending, setPending] = useState<Pending | undefined>(undefined);
  const resolvers = useMemo(() => inAppResolvers(setPending), []);

  // Refs, not state: state flips several awaits into an action, so two keys in
  // the same tick both pass a state-based guard and run the action twice.
  const running = useRef(false);
  const abort = useRef<(() => void) | undefined>(undefined);
  const alive = useRef(true);

  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const leave = useCallback(
    (leaving: Leaving = {}) => {
      onLeave(leaving);
      exit();
    },
    [exit, onLeave],
  );

  const load = useCallback(async () => {
    const outcome = await runAction(
      base,
      (context) => runLs({ all: false, prune: false }, context),
      (stop) => (abort.current = stop),
    );
    if (!alive.current) return;

    if (outcome.kind === "failed") {
      leave({ message: outcome.message });
      return;
    }
    const result = outcome.value;
    if (result.kind !== "ok") {
      leave({ message: renderLs(result) });
      return;
    }

    const next = worktreeRows(
      result.report.worktrees,
      result.report.spaces,
      base.cwd,
    );
    setTopology(result.report.topology);
    setRepos(result.report.repos.length);
    setRows(next);
    setOrphans(result.report.orphans.map((one) => one.path));
    setUnavailable(result.report.spaces.unavailable);
    setFocused((at) => {
      const here = next.findIndex((row) => row.here);
      if (here >= 0) return here;
      return Math.min(at, Math.max(next.length - 1, 0));
    });
    setView({ kind: "list" });
  }, [base, leave]);

  useEffect(() => {
    void load();
  }, [load]);

  const start = (label: string): void => {
    running.current = true;
    setNotice(undefined);
    setView({ kind: "busy", label });
  };

  const finish = (message?: string): void => {
    running.current = false;
    abort.current = undefined;
    if (!alive.current) return;
    setNotice(message);
    setView({ kind: "list" });
  };

  const act = (action: DashboardAction, row?: WorktreeRow): void => {
    // `quit` is outside the guard on purpose: raw mode swallows SIGINT, so a
    // screen that ignores keys while busy leaves no way out at all.
    if (action === "quit") {
      abort.current?.();
      leave();
      return;
    }
    if (running.current) return;

    if (action === "create") {
      setView({ kind: "creating" });
      return;
    }
    if (action === "refresh") {
      start("refreshing");
      void load();
      return;
    }
    if (row === undefined) return;

    const target = row.status.branch ?? row.status.path;

    if (action === "status") {
      start(`reading ${row.name}`);
      void runAction(
        base,
        (context) => runStatus({ repo: row.repoRoot, target }, context),
        (stop) => (abort.current = stop),
      ).then((outcome) => {
        running.current = false;
        abort.current = undefined;
        if (!alive.current) return;
        setView({
          kind: "showing",
          text:
            outcome.kind === "failed"
              ? outcome.message
              : renderStatus(outcome.value),
        });
      });
      return;
    }

    if (action === "open") {
      start(`opening ${row.name}`);
      void runAction(
        base,
        (context) =>
          runOpen({ repo: row.repoRoot, target, focus: true }, context),
        (stop) => (abort.current = stop),
      ).then((outcome) => {
        running.current = false;
        abort.current = undefined;
        finish(
          outcome.kind === "failed"
            ? outcome.message
            : outcome.value.kind === "opened" ||
                outcome.value.kind === "focused"
              ? undefined
              : renderOpen(outcome.value).trimEnd(),
        );
      });
      return;
    }

    start("checking");
    void runAction(
      base,
      async (context) => {
        const loaded =
          topology === undefined
            ? undefined
            : await configFor(topology, context);
        return loaded?.kind === "ok" ? loaded.config : DEFAULT_CONFIG;
      },
      (stop) => (abort.current = stop),
    ).then((outcome) => {
      running.current = false;
      abort.current = undefined;
      if (!alive.current) return;
      if (outcome.kind === "failed") {
        finish(outcome.message);
        return;
      }
      setView({
        kind: "removing",
        intent: removalIntent(row, findings(row.status), outcome.value),
      });
    });
  };

  const create = (branch: string): void => {
    if (running.current) return;
    const repo = topology?.repoRoot;
    start(`creating ${branch}`);
    void runAction(
      base,
      (context) =>
        runNew(
          {
            repo,
            branch,
            fetch: true,
            gitignore: true,
            open: true,
            focus: false,
            provision: true,
          },
          context,
        ),
      (stop) => (abort.current = stop),
      resolvers,
    ).then(async (outcome) => {
      const message =
        outcome.kind === "failed"
          ? outcome.message
          : outcome.value.kind === "created"
            ? undefined
            : renderNew(outcome.value, base.cwd).trimEnd();
      running.current = false;
      abort.current = undefined;
      await load();
      if (alive.current) setNotice(message);
    });
  };

  const decide = (remove: boolean): void => {
    if (running.current) return;
    const current = view;
    if (current.kind !== "removing" || !remove) {
      setView({ kind: "list" });
      return;
    }

    const intent = current.intent;
    start(`removing ${intent.row.name}`);
    void runAction(
      base,
      (context) =>
        runRm(
          {
            repo: intent.row.repoRoot,
            target: intent.row.status.branch ?? intent.row.status.path,
            force: false,
            deleteBranch: intent.branchPlan === "deleted",
          },
          context,
        ),
      (stop) => (abort.current = stop),
    ).then(async (outcome) => {
      // A refusal is the likely answer, not the exception: `wt rm` also checks
      // for live processes, which the row cannot know about.
      const message =
        outcome.kind === "failed"
          ? outcome.message
          : outcome.value.kind === "removed"
            ? undefined
            : renderRm(outcome.value).trimEnd();
      running.current = false;
      abort.current = undefined;
      await load();
      if (alive.current) setNotice(message);
    });
  };

  if (pending !== undefined) {
    if (pending.kind === "confirm") {
      return <Confirm question={pending.question} onAnswer={pending.answer} />;
    }
    if (pending.kind === "review") {
      return (
        <ConfigReviewScreen review={pending.review} onDecide={pending.answer} />
      );
    }
    return <Provisioning title={pending.title} subscribe={pending.subscribe} />;
  }

  if (view.kind === "showing") {
    return (
      <StatusView
        text={view.text}
        onBack={() => {
          setView({ kind: "list" });
        }}
      />
    );
  }

  if (view.kind === "creating") {
    return (
      <NewBranch
        repoName={
          repos > 1
            ? (topology?.parent.split("/").pop() ?? "")
            : (topology?.repoName ?? "")
        }
        onSubmit={(branch) => {
          create(branch);
        }}
        onCancel={() => {
          setView({ kind: "list" });
        }}
      />
    );
  }

  if (view.kind === "removing") {
    return <RemovePanel intent={view.intent} onAnswer={decide} />;
  }

  return (
    <Dashboard
      repoName={
        repos > 1
          ? (topology?.parent.split("/").pop() ?? "")
          : (topology?.repoName ?? "")
      }
      rows={rows}
      orphans={orphans}
      severalRepos={repos > 1}
      herdrUnavailable={unavailable}
      notice={notice}
      busy={view.kind === "busy" ? view.label : undefined}
      focused={focused}
      onFocus={setFocused}
      onAct={act}
    />
  );
};
