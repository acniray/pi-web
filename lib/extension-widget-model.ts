export type TaskTreeState =
  | "queued"
  | "running"
  | "complete"
  | "failed"
  | "partial"
  | "paused"
  | "stopped"
  | "rejected";

export interface TaskTreeActivity {
  state?: string;
  currentTool?: string;
  lastActivityAt?: number;
  currentToolStartedAt?: number;
  turnCount?: number;
  toolCount?: number;
}

export interface TaskTreeNode {
  /** Stable identity inside this rendered tree; adapters may namespace source ids. */
  key: string;
  /** Source protocol identity, preserved for future inspect/control actions. */
  id: string;
  label: string;
  state: TaskTreeState;
  /** Source-defined node category. Renderers treat this as descriptive metadata only. */
  type?: string;
  startedAt?: number;
  updatedAt?: number;
  endedAt?: number;
  activity?: TaskTreeActivity;
  children?: TaskTreeNode[];
}

export interface TaskTreeWidgetModel {
  kind: "task-tree";
  title: string;
  generatedAt?: number;
  nodes: TaskTreeNode[];
  omitted?: {
    nodes?: number;
    children?: number;
    byteLimitExceeded?: boolean;
  };
}

export type ExtensionWidgetPresentation =
  | { kind: "task-tree"; model: TaskTreeWidgetModel }
  | { kind: "text" };

export interface TaskTreeStateCounts {
  queued: number;
  running: number;
  complete: number;
  failed: number;
  partial: number;
  paused: number;
  stopped: number;
  rejected: number;
}

export function countTaskTreeStates(nodes: readonly TaskTreeNode[]): TaskTreeStateCounts {
  const counts: TaskTreeStateCounts = {
    queued: 0,
    running: 0,
    complete: 0,
    failed: 0,
    partial: 0,
    paused: 0,
    stopped: 0,
    rejected: 0,
  };

  const visit = (node: TaskTreeNode) => {
    counts[node.state] += 1;
    node.children?.forEach(visit);
  };
  nodes.forEach(visit);
  return counts;
}

export function countTaskTreeLeafStates(nodes: readonly TaskTreeNode[]): TaskTreeStateCounts {
  const counts: TaskTreeStateCounts = {
    queued: 0,
    running: 0,
    complete: 0,
    failed: 0,
    partial: 0,
    paused: 0,
    stopped: 0,
    rejected: 0,
  };

  const visit = (node: TaskTreeNode) => {
    if (node.children?.length) {
      node.children.forEach(visit);
      return;
    }
    counts[node.state] += 1;
  };
  nodes.forEach(visit);
  return counts;
}

export function findTaskTreeNode(
  nodes: readonly TaskTreeNode[],
  key: string | null,
): TaskTreeNode | null {
  if (!key) return null;
  for (const node of nodes) {
    if (node.key === key) return node;
    const nested = findTaskTreeNode(node.children ?? [], key);
    if (nested) return nested;
  }
  return null;
}

export function firstTaskTreeNode(nodes: readonly TaskTreeNode[]): TaskTreeNode | null {
  for (const node of nodes) {
    if (node.state !== "running" && node.state !== "queued") continue;
    const activeChild = firstTaskTreeNode(
      (node.children ?? []).filter((child) => child.state === "running" || child.state === "queued"),
    );
    if (activeChild) return activeChild;
    return node;
  }
  return nodes[0] ?? null;
}
