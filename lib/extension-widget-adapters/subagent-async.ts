import type { ExtensionWidgetItem } from "@/lib/types";
import type {
  TaskTreeActivity,
  TaskTreeNode,
  TaskTreeState,
  TaskTreeWidgetModel,
} from "@/lib/extension-widget-model";

const PREFIX = "PI_SUBAGENT_ASYNC_JSON:";
const SNAPSHOT_KIND = "pi-subagents.async-status-snapshot";
const SNAPSHOT_VERSION = 1;
const MAX_PARSE_DEPTH = 12;
const MAX_SNAPSHOT_CHARS = 64 * 1024;

const VALID_STATES = new Set<TaskTreeState>([
  "queued",
  "running",
  "complete",
  "failed",
  "partial",
  "paused",
  "stopped",
  "rejected",
]);

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedString(value: unknown, max = 512): string | undefined {
  return typeof value === "string" && value.length > 0
    ? value.slice(0, max)
    : undefined;
}

function nonNegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function parseActivity(value: unknown): TaskTreeActivity | undefined {
  const source = record(value);
  if (!source) return undefined;
  const activity: TaskTreeActivity = {
    state: boundedString(source.state, 128),
    currentTool: boundedString(source.currentTool, 160),
    lastActivityAt: nonNegativeNumber(source.lastActivityAt),
    currentToolStartedAt: nonNegativeNumber(source.currentToolStartedAt),
    turnCount: nonNegativeNumber(source.turnCount),
    toolCount: nonNegativeNumber(source.toolCount),
  };
  return Object.values(activity).some((entry) => entry !== undefined)
    ? activity
    : undefined;
}

function parseNodes(values: unknown[], depth: number, parentKey: string): TaskTreeNode[] {
  const occurrences = new Map<string, number>();
  return values.map((value) => {
    const id = boundedString(record(value)?.id, 256) ?? '';
    const occurrence = occurrences.get(id) ?? 0;
    occurrences.set(id, occurrence + 1);
    return parseNode(value, depth, parentKey, occurrence);
  }).filter((node): node is TaskTreeNode => node !== null);
}

function parseNode(
  value: unknown,
  depth = 0,
  parentKey = "root",
  index = 0,
): TaskTreeNode | null {
  if (depth > MAX_PARSE_DEPTH) return null;
  const source = record(value);
  if (!source) return null;

  const id = boundedString(source.id, 256);
  const label = boundedString(source.label, 512);
  const state = boundedString(source.state, 32) as TaskTreeState | undefined;
  if (!id || !label || !state || !VALID_STATES.has(state)) return null;

  const key = `${parentKey}/${encodeURIComponent(id)}:${index}`;
  const children = Array.isArray(source.children)
    ? parseNodes(source.children, depth + 1, key)
    : [];

  const type = boundedString(source.kind, 64);
  const activity = parseActivity(source.activity);
  return {
    key,
    id,
    label,
    state,
    ...(type ? { type } : {}),
    ...(nonNegativeNumber(source.startedAt) !== undefined
      ? { startedAt: nonNegativeNumber(source.startedAt) }
      : {}),
    ...(nonNegativeNumber(source.updatedAt) !== undefined
      ? { updatedAt: nonNegativeNumber(source.updatedAt) }
      : {}),
    ...(nonNegativeNumber(source.endedAt) !== undefined
      ? { endedAt: nonNegativeNumber(source.endedAt) }
      : {}),
    ...(activity ? { activity } : {}),
    ...(children.length > 0 ? { children } : {}),
  };
}

function parseSnapshotLine(line: string): TaskTreeWidgetModel | null {
  if (line.length > MAX_SNAPSHOT_CHARS) return null;
  const prefixIndex = line.indexOf(PREFIX);
  if (prefixIndex < 0) return null;

  try {
    const source = record(JSON.parse(line.slice(prefixIndex + PREFIX.length)));
    if (!source || source.kind !== SNAPSHOT_KIND || source.version !== SNAPSHOT_VERSION) return null;
    if (!Array.isArray(source.runs)) return null;

    const nodes = parseNodes(source.runs, 0, "root");
    const omitted = record(source.omitted);
    const omittedNodes = nonNegativeNumber(omitted?.runs);
    const omittedChildren = nonNegativeNumber(omitted?.children);
    const byteLimitExceeded = typeof omitted?.byteLimitExceeded === "boolean"
      ? omitted.byteLimitExceeded
      : undefined;

    return {
      kind: "task-tree",
      title: "Async agents",
      generatedAt: nonNegativeNumber(source.generatedAt),
      nodes,
      ...((omittedNodes !== undefined || omittedChildren !== undefined || byteLimitExceeded !== undefined)
        ? {
            omitted: {
              ...(omittedNodes !== undefined ? { nodes: omittedNodes } : {}),
              ...(omittedChildren !== undefined ? { children: omittedChildren } : {}),
              ...(byteLimitExceeded !== undefined ? { byteLimitExceeded } : {}),
            },
          }
        : {}),
    };
  } catch {
    return null;
  }
}

/**
 * Decode pi-subagents' documented RPC widget protocol into Pi Web's generic
 * task-tree model. The web renderer never needs to know what a workflow or
 * subagent is; protocol-specific knowledge stops at this adapter.
 */
export function decodeSubagentAsyncWidget(
  widget: ExtensionWidgetItem,
): TaskTreeWidgetModel | null {
  for (const line of widget.lines) {
    const parsed = parseSnapshotLine(line);
    if (parsed) return parsed;
  }
  return null;
}
