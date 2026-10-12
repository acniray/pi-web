import type { SessionInfo } from "./types";

export interface SessionFamily {
  root: SessionInfo;
  subagents: SessionInfo[];
  latestModified: string;
}

function resolveFamilyRoots(sessions: readonly SessionInfo[]): Map<string, string | null> {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const roots = new Map<string, string | null>();

  for (const session of sessions) {
    if (roots.has(session.id)) continue;

    const path: string[] = [];
    const visited = new Set<string>();
    let currentId = session.id;
    let rootId: string | null = null;

    while (true) {
      if (roots.has(currentId)) {
        rootId = roots.get(currentId) ?? null;
        break;
      }
      if (visited.has(currentId)) break;

      visited.add(currentId);
      path.push(currentId);
      const current = byId.get(currentId);
      if (!current) break;
      if (current.relation?.kind !== "subagent") {
        rootId = current.id;
        break;
      }
      currentId = current.relation.parentSessionId;
    }

    for (const id of path) roots.set(id, rootId);
  }

  return roots;
}

/** Groups visible main/fork sessions with every persisted subagent descendant. */
export function listSessionFamilies(sessions: readonly SessionInfo[]): SessionFamily[] {
  const rootsBySessionId = resolveFamilyRoots(sessions);
  const families = new Map<string, SessionFamily>();

  for (const session of sessions) {
    if (session.relation?.kind === "subagent") continue;
    families.set(session.id, {
      root: session,
      subagents: [],
      latestModified: session.modified,
    });
  }

  for (const session of sessions) {
    if (session.relation?.kind !== "subagent") continue;
    const rootId = rootsBySessionId.get(session.id);
    const family = rootId ? families.get(rootId) : undefined;
    if (!family) continue;
    family.subagents.push(session);
    if (session.modified > family.latestModified) family.latestModified = session.modified;
  }

  return [...families.values()].sort((a, b) => b.latestModified.localeCompare(a.latestModified));
}

export function getSessionFamily(
  sessions: readonly SessionInfo[],
  sessionId: string | null | undefined,
): SessionFamily | null {
  if (!sessionId) return null;
  return listSessionFamilies(sessions).find((family) => (
    family.root.id === sessionId
    || family.subagents.some((session) => session.id === sessionId)
  )) ?? null;
}

/**
 * The outermost session that owns `session`, walking `relation.parentSessionId`
 * through the given rows. A parent that is itself absent from the list is the
 * answer: its children belong to it, not to whatever it may hang from.
 *
 * This is the same walk `listSessionFamilies` groups by, exposed for callers
 * that hold one row and need its family before the rest has loaded.
 */
export function familyRootIdFor(
  sessions: readonly SessionInfo[],
  session: SessionInfo,
): string {
  const byId = new Map(sessions.map((row) => [row.id, row]));
  const visited = new Set<string>();
  let current = session;
  while (current.relation?.kind === "subagent" && !visited.has(current.id)) {
    visited.add(current.id);
    const parentId = current.relation.parentSessionId;
    const parent = byId.get(parentId);
    if (!parent) return parentId;
    current = parent;
  }
  return current.id;
}

/**
 * Add one row to a catalogue copy, replacing a row the catalogue already has.
 *
 * A session that is the child of another session is deliberately absent from
 * the catalogue: the sidebar shows it inside its parent's row, and deriving it
 * there would mean scanning every session directory. A deep link to such a
 * child therefore arrives through the child route instead, and the caller has
 * to merge that one row into its list to select it.
 */
export function appendSessionRow(
  sessions: readonly SessionInfo[],
  row: SessionInfo,
): SessionInfo[] {
  return [...sessions.filter((session) => session.id !== row.id), row];
}
