export const NICOBAILON_ASYNC_WIDGET_KEY = "subagent-async";
export const NICOBAILON_FLEET_WIDGET_KEY = "subagent-fleet-status";
export const NICOBAILON_ASYNC_WIDGET_PREFIX = "PI_SUBAGENT_ASYNC_JSON:";

export type NicobailonAsyncState =
  | "queued"
  | "running"
  | "complete"
  | "failed"
  | "partial"
  | "paused"
  | "stopped"
  | "rejected";

export type NicobailonAsyncNodeKind = "subagent" | "workflow" | "step" | "host-step";

export interface NicobailonAsyncActivity {
  state?: string;
  currentTool?: string;
  lastActivityAt?: number;
  currentToolStartedAt?: number;
  turnCount?: number;
  toolCount?: number;
}

export interface NicobailonAsyncNode {
  id: string;
  kind: NicobailonAsyncNodeKind;
  label: string;
  state: NicobailonAsyncState;
  startedAt?: number;
  updatedAt?: number;
  endedAt?: number;
  activity?: NicobailonAsyncActivity;
  children?: NicobailonAsyncNode[];
}

export interface NicobailonAsyncSnapshot {
  kind: "pi-subagents.async-status-snapshot";
  version: 1;
  generatedAt: number;
  runs: NicobailonAsyncNode[];
  omitted?: {
    runs?: number;
    children?: number;
    byteLimitExceeded?: boolean;
  };
}

const VALID_STATES = new Set<NicobailonAsyncState>([
  "queued",
  "running",
  "complete",
  "failed",
  "partial",
  "paused",
  "stopped",
  "rejected",
]);

const VALID_KINDS = new Set<NicobailonAsyncNodeKind>([
  "subagent",
  "workflow",
  "step",
  "host-step",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function boundedString(value: unknown, maxLength = 512): string | undefined {
  return typeof value === "string" && value.length > 0 ? value.slice(0, maxLength) : undefined;
}

function parseActivity(value: unknown): NicobailonAsyncActivity | undefined {
  if (!isRecord(value)) return undefined;
  const activity: NicobailonAsyncActivity = {
    state: boundedString(value.state, 128),
    currentTool: boundedString(value.currentTool, 160),
    lastActivityAt: finiteNonNegative(value.lastActivityAt),
    currentToolStartedAt: finiteNonNegative(value.currentToolStartedAt),
    turnCount: finiteNonNegative(value.turnCount),
    toolCount: finiteNonNegative(value.toolCount),
  };
  return Object.values(activity).some((entry) => entry !== undefined) ? activity : undefined;
}

function parseNode(value: unknown, depth = 0): NicobailonAsyncNode | null {
  if (!isRecord(value) || depth > 8) return null;
  const id = boundedString(value.id, 256);
  const label = boundedString(value.label, 512);
  const kind = boundedString(value.kind, 32) as NicobailonAsyncNodeKind | undefined;
  const state = boundedString(value.state, 32) as NicobailonAsyncState | undefined;
  if (!id || !label || !kind || !state || !VALID_KINDS.has(kind) || !VALID_STATES.has(state)) return null;

  const children = Array.isArray(value.children)
    ? value.children
        .map((child) => parseNode(child, depth + 1))
        .filter((child): child is NicobailonAsyncNode => child !== null)
    : [];

  return {
    id,
    kind,
    label,
    state,
    startedAt: finiteNonNegative(value.startedAt),
    updatedAt: finiteNonNegative(value.updatedAt),
    endedAt: finiteNonNegative(value.endedAt),
    activity: parseActivity(value.activity),
    ...(children.length > 0 ? { children } : {}),
  };
}

export function parseNicobailonAsyncSnapshot(
  lines: readonly string[],
): NicobailonAsyncSnapshot | null {
  for (const line of lines) {
    const prefixIndex = line.indexOf(NICOBAILON_ASYNC_WIDGET_PREFIX);
    if (prefixIndex < 0) continue;
    try {
      const value = JSON.parse(line.slice(prefixIndex + NICOBAILON_ASYNC_WIDGET_PREFIX.length)) as unknown;
      if (!isRecord(value)) continue;
      if (value.kind !== "pi-subagents.async-status-snapshot" || value.version !== 1) continue;
      const generatedAt = finiteNonNegative(value.generatedAt);
      if (generatedAt === undefined || !Array.isArray(value.runs)) continue;
      const runs = value.runs
        .map((run) => parseNode(run))
        .filter((run): run is NicobailonAsyncNode => run !== null);
      const omitted = isRecord(value.omitted)
        ? {
            runs: finiteNonNegative(value.omitted.runs),
            children: finiteNonNegative(value.omitted.children),
            byteLimitExceeded: typeof value.omitted.byteLimitExceeded === "boolean"
              ? value.omitted.byteLimitExceeded
              : undefined,
          }
        : undefined;
      return {
        kind: "pi-subagents.async-status-snapshot",
        version: 1,
        generatedAt,
        runs,
        ...(omitted ? { omitted } : {}),
      };
    } catch {
      // Leave malformed host payloads visible through the generic widget renderer.
    }
  }
  return null;
}

export function findNicobailonAsyncSnapshot(
  widgets: readonly { key: string; lines: readonly string[] }[],
): NicobailonAsyncSnapshot | null {
  const widget = widgets.find((candidate) => candidate.key === NICOBAILON_ASYNC_WIDGET_KEY);
  return widget ? parseNicobailonAsyncSnapshot(widget.lines) : null;
}

export function isNicobailonHostStatusWidget(key: string): boolean {
  return key === NICOBAILON_ASYNC_WIDGET_KEY || key === NICOBAILON_FLEET_WIDGET_KEY;
}
