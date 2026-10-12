import { getAgentDir } from '@earendil-works/pi-coding-agent';
import { lstatSync, realpathSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { readRegularFileText } from './regular-file';
import { readSessionHeader, readSessionInfoUnprojected, cacheSessionPath, openSessionManager } from './session-reader';
import { identifyContainedSession, isRegularStoredSessionFile, resolveSessionOwnership } from './session-relationship';
export { identifyContainedSession } from './session-relationship';
import { projectIdentityKey } from './project-identity';
import type { SessionInfo, SubagentSessionStatus } from './types';

const MAX_CHILDREN = 1000;
const MAX_DEPTH = 6;
const MAX_ENTRIES = 5000;
/**
 * The child list is keyed by its inputs' fingerprints instead of being
 * re-derived on a fixed timer: an unchanged parent, container and status
 * documents answer from this cache, while any of them changing re-derives it.
 */
interface ChildrenDiscoveryEntry {
  signature: string;
  sessions: SessionInfo[];
}
const childrenDiscovery = new Map<string, ChildrenDiscoveryEntry>();
/** Drops the cached child list of one parent, or of every parent. */
export function invalidateSessionChildrenDiscovery(parentPath?: string): void {
  if (parentPath) childrenDiscovery.delete(resolve(parentPath));
  else childrenDiscovery.clear();
}
export interface SessionReference {
  label?: string;
  sessionName?: string;
  agent?: string;
  status?: SubagentSessionStatus;
}
function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim()
    ? value.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 256) : undefined;
}
function status(value: unknown): SubagentSessionStatus | undefined {
  if (value === 'pending') return 'queued';
  if (value === 'complete') return 'completed';
  if (value === 'stopped') return 'aborted';
  return ['starting', 'queued', 'running', 'completed', 'failed', 'aborted', 'interrupted', 'unknown'].includes(String(value))
    ? value as SubagentSessionStatus : undefined;
}
/** Tool-result details are data, not a plugin identity. Only explicit session references qualify. */
export function collectSessionReferences(value: unknown): Map<string, SessionReference> {
  const refs = new Map<string, SessionReference>();
  const queue: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let visited = 0;
  while (queue.length && visited++ < MAX_ENTRIES) {
    const item = queue.shift()!;
    if (!item.value || typeof item.value !== 'object' || item.depth > 10) continue;
    if (Array.isArray(item.value)) {
      for (const child of item.value.slice(0, Math.max(0, MAX_ENTRIES - queue.length))) queue.push({ value: child, depth: item.depth + 1 });
      continue;
    }
    const record = item.value as Record<string, unknown>;
    const file = record.sessionFile ?? record.sessionPath;
    if (typeof file === 'string' && isAbsolute(file) && file.endsWith('.jsonl')) {
      const key = resolve(file);
      const previous = refs.get(key) ?? {};
      const next = {
        label: text(record.label), sessionName: text(record.sessionName), agent: text(record.agent),
        status: status(record.status) ?? (typeof record.exitCode === 'number' ? record.exitCode === 0 ? 'completed' : 'failed' : undefined),
      };
      for (const [key, value] of Object.entries(next)) if (value !== undefined) Object.assign(previous, { [key]: value });
      refs.set(key, previous);
    }
    for (const child of Object.values(record).slice(0, Math.max(0, MAX_ENTRIES - queue.length))) {
      if (child && typeof child === 'object') queue.push({ value: child, depth: item.depth + 1 });
    }
  }
  return refs;
}
function contained(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/** Small compatibility boundary for tools publishing asyncDir/status.json.
 * No package locations, tool names or UUID layouts are assumed. The document
 * must assert this parent session's ownership before its references are used.
 */
function referencedStatusMetadata(details: unknown, parentId: string, parentPath: string, statusFiles: Set<string>): Map<string, SessionReference> {
  const refs = new Map<string, SessionReference>();
  const queue: unknown[] = [details];
  let visited = 0;
  let filesRead = 0;
  while (queue.length && visited++ < MAX_ENTRIES && filesRead < 32) {
    const value = queue.shift();
    if (!value || typeof value !== 'object') continue;
    const record = value as Record<string, unknown>;
    if (typeof record.asyncDir === 'string' && isAbsolute(record.asyncDir)) {
      try {
        const path = join(record.asyncDir, 'status.json');
        const real = realpathSync(path);
        if (![tmpdir(), getAgentDir()].some(root => contained(realpathSync(root), real)) || lstatSync(path).isSymbolicLink()) continue;
        filesRead++;
        // The document decides labels and can decide ownership, so its own
        // bytes take part in the unchanged-container signature below.
        statusFiles.add(path);
        const text = readRegularFileText(path, 1024 * 1024);
        const status = text ? JSON.parse(text) : null;
        const owner = status?.sessionId;
        if (owner === parentId || (typeof owner === 'string' && isAbsolute(owner) && resolve(owner) === resolve(parentPath))) {
          for (const [path, ref] of collectSessionReferences(status)) refs.set(path, ref);
        }
      } catch { /* Missing, oversized, foreign or incomplete async metadata is optional. */ }
    }
    for (const child of Object.values(record).slice(0, Math.max(0, MAX_ENTRIES - queue.length))) if (child && typeof child === 'object') queue.push(child);
  }
  return refs;
}
/** The container's own file listing: where a new child shows up first. */
async function scanContainer(container: string): Promise<Set<string>> {
  const paths = new Set<string>();
  const queue = [{ path: container, depth: 0 }];
  let entriesRead = 0;
  while (queue.length && paths.size < MAX_CHILDREN && entriesRead < MAX_ENTRIES) {
    const dir = queue.shift()!;
    let entries;
    try {
      if (lstatSync(dir.path).isSymbolicLink()) continue;
      entries = await readdir(dir.path, { withFileTypes: true });
    } catch { continue; }
    for (const entry of entries) {
      if (++entriesRead > MAX_ENTRIES || paths.size >= MAX_CHILDREN) break;
      const path = join(dir.path, entry.name);
      if (entry.isFile() && entry.name.endsWith('.jsonl')) paths.add(path);
      else if (entry.isDirectory() && dir.depth < MAX_DEPTH) queue.push({ path, depth: dir.depth + 1 });
    }
  }
  return paths;
}
/** Parent history plus the container's files: the two things a child list comes from. */
async function childrenSignature(parentPath: string, containerPaths: Iterable<string>, statusFiles: Iterable<string>): Promise<string> {
  const parts: string[] = [];
  try {
    const stats = await stat(parentPath);
    parts.push(`${stats.size}:${stats.mtimeMs}`);
  } catch { /* A parent that vanished still yields an empty list. */ }
  const listed: string[] = [];
  for (const path of [...containerPaths, ...statusFiles]) {
    try {
      const stats = await stat(path);
      listed.push(`${resolve(path)}|${stats.size}|${stats.mtimeMs}`);
    } catch { listed.push(resolve(path)); }
  }
  listed.sort();
  return `${parts.join(':')}#${listed.join('\n')}`;
}
/** Labels and live status declared by the parent's own tool results. */
function collectChildReferences(parentId: string, parentPath: string, statusFiles: Set<string>): Map<string, SessionReference> {
  const references = new Map<string, SessionReference>();
  const currentReferences = new Map<string, SessionReference>();
  for (const entry of openSessionManager(parentPath).getBranch()) {
    if (entry.type !== 'message' || entry.message.role !== 'toolResult') continue;
    for (const [path, ref] of collectSessionReferences(entry.message.details)) references.set(path, { ...references.get(path), ...ref });
    for (const [path, ref] of referencedStatusMetadata(entry.message.details, parentId, parentPath, statusFiles)) currentReferences.set(path, { ...currentReferences.get(path), ...ref });
  }
  for (const [path, ref] of currentReferences) references.set(path, { ...references.get(path), ...ref });
  return references;
}
export async function listSessionChildren(parentId: string, parentPath: string): Promise<SessionInfo[]> {
  if (!isRegularStoredSessionFile(parentPath) || readSessionHeader(parentPath)?.id !== parentId) return [];
  const container = parentPath.slice(0, -'.jsonl'.length);
  // The parent's history is the source of labels, live status and referenced
  // paths, so it is read before the cheap container listing decides whether
  // anything changed since the last identical answer.
  const statusFiles = new Set<string>();
  const references = collectChildReferences(parentId, parentPath, statusFiles);
  const paths = await scanContainer(container);
  // Tool-result paths supply labels/status, not ownership. An explicit path is
  // eligible only when the same on-disk parent relationship independently holds.
  for (const path of references.keys()) {
    if (paths.size >= MAX_CHILDREN) break;
    if (identifyContainedSession(path)?.id === parentId) paths.add(path);
  }
  const signature = await childrenSignature(parentPath, paths, statusFiles);
  const cacheKey = resolve(parentPath);
  const cached = childrenDiscovery.get(cacheKey);
  if (cached && cached.signature === signature) return cached.sessions;
  const sessions = await discoverSessionChildren(parentId, parentPath, paths, references);
  childrenDiscovery.set(cacheKey, { signature, sessions });
  return sessions;
}
/** The cached rows are shared, read-only values; callers must not mutate them. */
async function discoverSessionChildren(parentId: string, parentPath: string, paths: Set<string>, references: Map<string, SessionReference>): Promise<SessionInfo[]> {
  const sessions: SessionInfo[] = [];
  // The children list never runs project resolution; the parent's own workspace
  // is the workspace its children work in (AppShell resolves it through
  // sessionWorkspaceCwd and the detail row falls back to projectRoot).
  const parentCwd = readSessionHeader(parentPath)?.cwd;
  for (const path of paths) {
    if (!isRegularStoredSessionFile(path)) continue;
    const info = await readSessionInfoUnprojected(path);
    if (!info || info.id === parentId) continue;
    const relation = resolveSessionOwnership(info);
    const directOwner = relation.owner;
    if (!directOwner) continue;
    // Keep the direct parent edge for nested children while including every
    // verified descendant in the selected root family's response.
    let ancestor: typeof directOwner | null = directOwner;
    let belongsToFamily = false;
    const seen = new Set<string>();
    for (let depth = 0; ancestor && depth < MAX_DEPTH && !seen.has(ancestor.path); depth++) {
      seen.add(ancestor.path);
      if (ancestor.id === parentId) { belongsToFamily = true; break; }
      ancestor = identifyContainedSession(ancestor.path);
    }
    if (!belongsToFamily) continue;
    const ref = references.get(resolve(path));
    const contained = relation.relation?.kind === 'subagent' ? relation.relation : undefined;
    const title = ref?.label ?? ref?.sessionName ?? info.displayName ?? ref?.agent;
    cacheSessionPath(info.id, path);
    sessions.push({ ...info, ...(title ? { displayName: title } : {}), parentSessionId: directOwner.id,
      ...(parentCwd ? { projectRoot: parentCwd, projectKey: projectIdentityKey(parentCwd) } : {}),
      relation: { kind: 'subagent', parentSessionId: directOwner.id,
        profile: ref?.agent ?? (contained ? contained.profile : 'subagent'),
        description: title ?? 'subagent',
        status: ref?.status ?? (contained ? contained.status : 'unknown') },
    });
  }
  return sessions.sort((a, b) => b.modified.localeCompare(a.modified));
}
