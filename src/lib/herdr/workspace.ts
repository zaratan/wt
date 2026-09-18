import type { HerdrClient } from "./socket.js";
import {
  collectPaneIds,
  type LayoutApplyResult,
  type PaneListResult,
  type WorkspaceInfo,
  type WorkspaceListResult,
  type WorktreeOpenResult,
} from "./types.js";
import type { HerdrLayout, PaneAssignment } from "../layout/toHerdr.js";

export type SpaceStep =
  | "worktree.open"
  | "layout.apply"
  | "agent.start"
  | "pane.run"
  | "workspace.focus";

export type StepOutcome = {
  step: SpaceStep;
  ok: boolean;
  detail?: string;
};

export type OpenSpaceInput = {
  repoRoot: string;
  worktreePath: string;
  label: string;
  layout: HerdrLayout;
  panes: readonly PaneAssignment[];
  focus: boolean;
  /** Commands to type are held back until provisioning succeeds. */
  runCommands: boolean;
  agentName: string;
};

export type OpenSpaceResult = {
  workspaceId?: string;
  alreadyOpen: boolean;
  /** label → pane_id, for whatever was laid out. */
  paneIds: ReadonlyMap<string, string>;
  steps: readonly StepOutcome[];
  /** Commands not run, so the caller can print them instead. */
  deferred: readonly { paneId: string; command: string }[];
};

/**
 * herdr is the registry: `WorkspaceInfo.worktree` is filled for spaces opened
 * through `worktree.open`, so nothing has to be stored on our side.
 */
export const listSpaces = async (
  client: HerdrClient,
): Promise<readonly WorkspaceInfo[] | undefined> => {
  const listed = await client.call<WorkspaceListResult>("workspace.list");
  return listed.kind === "ok" ? listed.result.workspaces : undefined;
};

export const findSpaceFor = async (
  client: HerdrClient,
  worktreePath: string,
): Promise<WorkspaceInfo | undefined> => {
  const listed = await client.call<WorkspaceListResult>("workspace.list");
  if (listed.kind !== "ok") return undefined;
  return listed.result.workspaces.find(
    (workspace) => workspace.worktree?.checkout_path === worktreePath,
  );
};

/** A herdr agent name: lowercase, and unique among the living ones. */
export const agentNameFrom = (
  label: string,
  taken: readonly string[],
): string => {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/^[^a-z]+/, "")
      .slice(0, 31) || "wt";

  if (!taken.includes(base)) return base;
  for (let suffix = 2; suffix < 100; suffix += 1) {
    const candidate = `${base.slice(0, 28)}-${String(suffix)}`;
    if (!taken.includes(candidate)) return candidate;
  }
  return base;
};

const livingAgents = async (client: HerdrClient): Promise<string[]> => {
  const listed = await client.call<{ agents?: { agent?: string }[] }>(
    "agent.list",
  );
  if (listed.kind !== "ok") return [];
  return (listed.result.agents ?? [])
    .map((agent) => agent.agent)
    .filter((name): name is string => typeof name === "string");
};

/**
 * A pane must be at its prompt before anything is typed into it. Polling
 * `pane.process_info` is best-effort: if herdr does not answer, a short wait is
 * better than refusing to start.
 */
const waitForPrompt = async (
  client: HerdrClient,
  paneId: string,
  timeoutMs = 10_000,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const info = await client.call<{ argv0?: string }>("pane.process_info", {
      pane_id: paneId,
    });
    if (info.kind !== "ok") break;
    if (typeof info.result.argv0 === "string") return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  await new Promise((resolve) => setTimeout(resolve, 300));
};

export const openSpace = async (
  client: HerdrClient,
  input: OpenSpaceInput,
): Promise<OpenSpaceResult> => {
  const steps: StepOutcome[] = [];
  const deferred: { paneId: string; command: string }[] = [];

  const opened = await client.call<WorktreeOpenResult>("worktree.open", {
    cwd: input.repoRoot,
    path: input.worktreePath,
    label: input.label,
    focus: false,
  });

  if (opened.kind !== "ok") {
    steps.push({
      step: "worktree.open",
      ok: false,
      detail: opened.kind === "error" ? opened.error.message : opened.message,
    });
    return { alreadyOpen: false, paneIds: new Map(), steps, deferred };
  }

  // The schema says these are always there; a version that disagrees would
  // throw here, after the worktree exists. Degrade instead.
  const workspaceId = opened.result.workspace?.workspace_id;
  const tabId = opened.result.tab?.tab_id;
  if (workspaceId === undefined || tabId === undefined) {
    steps.push({
      step: "worktree.open",
      ok: false,
      detail: "herdr answered worktree.open in an unexpected shape",
    });
    return { alreadyOpen: false, paneIds: new Map(), steps, deferred };
  }

  const alreadyOpen = opened.result.already_open === true;
  steps.push({ step: "worktree.open", ok: true });

  const applied = await client.call<LayoutApplyResult>("layout.apply", {
    tab_id: tabId,
    root: input.layout,
  });

  // Barrel two of the degradation ladder: the space exists with one pane in the
  // right place, which is a usable terminal, and we say what did not happen.
  if (applied.kind !== "ok") {
    steps.push({
      step: "layout.apply",
      ok: false,
      detail:
        applied.kind === "error" ? applied.error.message : applied.message,
    });
    return { workspaceId, alreadyOpen, paneIds: new Map(), steps, deferred };
  }
  steps.push({ step: "layout.apply", ok: true });

  let paneIds = collectPaneIds(applied.result.layout?.root);
  if (paneIds.size === 0) {
    // The schema allows pane_id to be null; labels round-trip either way.
    const listed = await client.call<PaneListResult>("pane.list", {
      workspace_id: workspaceId,
    });
    if (listed.kind === "ok") {
      paneIds = new Map(
        listed.result.panes
          .filter((pane) => typeof pane.label === "string")
          .map((pane) => [pane.label ?? "", pane.pane_id]),
      );
    }
  }

  const taken = await livingAgents(client);

  for (const pane of input.panes) {
    const paneId = paneIds.get(pane.label);
    if (paneId === undefined) continue;

    if (pane.kind === "agent") {
      await waitForPrompt(client, paneId);
      const name = agentNameFrom(input.agentName, taken);
      const started = await client.call("agent.start", {
        name,
        kind: "claude",
        pane_id: paneId,
      });
      taken.push(name);
      steps.push({
        step: "agent.start",
        ok: started.kind === "ok",
        detail:
          started.kind === "error"
            ? started.error.message
            : started.kind === "unreachable"
              ? started.message
              : name,
      });
      continue;
    }

    if (pane.kind === "command") {
      if (!input.runCommands) {
        deferred.push({ paneId, command: pane.command });
        continue;
      }
      await waitForPrompt(client, paneId);
      const ran = await client.call("pane.run", {
        pane_id: paneId,
        command: pane.command,
      });
      steps.push({
        step: "pane.run",
        ok: ran.kind === "ok",
        detail: ran.kind === "ok" ? pane.command : undefined,
      });
    }
  }

  if (input.focus) {
    steps.push({
      step: "workspace.focus",
      ok: await focusSpace(client, workspaceId),
    });
  }

  return { workspaceId, alreadyOpen, paneIds, steps, deferred };
};

export const focusSpace = async (
  client: HerdrClient,
  workspaceId: string,
): Promise<boolean> => {
  const focused = await client.call("workspace.focus", {
    workspace_id: workspaceId,
  });
  return focused.kind === "ok";
};

export const closeSpace = async (
  client: HerdrClient,
  workspaceId: string,
): Promise<{ ok: boolean; detail?: string }> => {
  const closed = await client.call("workspace.close", {
    workspace_id: workspaceId,
  });
  if (closed.kind === "ok") return { ok: true };

  // Closing a primary workspace with open worktree children needs explicit
  // group intent. Only ours are ours to close, so we report instead of forcing.
  if (
    closed.kind === "error" &&
    closed.error.code === "workspace_group_close_required"
  ) {
    return {
      ok: false,
      detail:
        "herdr wants explicit group intent: other worktree spaces are open under this one",
    };
  }
  return {
    ok: false,
    detail: closed.kind === "error" ? closed.error.message : closed.message,
  };
};
