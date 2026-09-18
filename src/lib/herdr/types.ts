export type WorktreeInfo = {
  repo_key?: string;
  repo_name?: string;
  repo_root?: string;
  checkout_path?: string;
  is_linked_worktree?: boolean;
};

export type WorkspaceInfo = {
  workspace_id: string;
  label?: string;
  focused?: boolean;
  agent_status?: string;
  /** Filled only when the space was opened through `worktree.open|create`. */
  worktree?: WorktreeInfo | null;
};

export type TabInfo = { tab_id: string };
export type PaneInfo = {
  pane_id: string;
  label?: string;
  cwd?: string;
  foreground_cwd?: string;
};

export type WorktreeOpenResult = {
  workspace: WorkspaceInfo;
  tab: TabInfo;
  root_pane: PaneInfo;
  already_open?: boolean;
};

export type LayoutNodeReply = {
  type: "pane" | "split";
  pane_id?: string | null;
  label?: string | null;
  first?: LayoutNodeReply;
  second?: LayoutNodeReply;
};

export type LayoutApplyResult = {
  layout: {
    workspace_id: string;
    tab_id: string;
    root: LayoutNodeReply;
  };
};

export type WorkspaceListResult = { workspaces: readonly WorkspaceInfo[] };
export type PaneListResult = { panes: readonly PaneInfo[] };

export const collectPaneIds = (
  node: LayoutNodeReply | undefined,
  into: Map<string, string> = new Map(),
): Map<string, string> => {
  if (node === undefined) return into;
  if (
    node.type === "pane" &&
    typeof node.label === "string" &&
    typeof node.pane_id === "string"
  ) {
    into.set(node.label, node.pane_id);
  }
  collectPaneIds(node.first, into);
  collectPaneIds(node.second, into);
  return into;
};
