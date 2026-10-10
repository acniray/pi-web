import { getAgentDir } from '@earendil-works/pi-coding-agent';
import { lstatSync, realpathSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { readRegularFileText } from './regular-file';
import { readSessionHeader, readSessionInfo, cacheSessionPath, openSessionManager } from './session-reader';
import type { SessionInfo, SubagentSessionStatus } from './types';

const MAX_CHILDREN = 1000;
const MAX_DEPTH = 6;
const MAX_ENTRIES = 5000;
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
function storageRoot(): string { return resolve(getAgentDir(), 'sessions'); }

/** Small compatibility boundary for tools publishing asyncDir/status.json.
 * No package locations, tool names or UUID layouts are assumed. The document
 * must assert this parent session's ownership before its references are used.
 */
function referencedStatusMetadata(details: unknown, parentId: string, parentPath: string): Map<string, SessionReference> {
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
function regularStoredFile(path: string): boolean {
  try {
    const root = realpathSync(storageRoot());
    return contained(root, realpathSync(path)) && lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink();
  } catch { return false; }
}
/** Compatibility for session-owned containers: a containing directory has a sibling JSONL owner. */
export function identifyContainedSession(filePath: string): { id: string; path: string; cwd: string } | null {
  const root = storageRoot();
  const path = resolve(filePath);
  if (!contained(root, path) || !regularStoredFile(path)) return null;
  let dir = dirname(path);
  for (let depth = 0; depth < MAX_DEPTH && contained(root, dir); depth++, dir = dirname(dir)) {
    const owner = `${dir}.jsonl`;
    if (!regularStoredFile(owner)) continue;
    try {
      const header = readSessionHeader(owner);
      if (header?.id && header.cwd) return { id: header.id, path: owner, cwd: header.cwd };
    } catch { /* malformed or removed owner */ }
  }
  return null;
}
export async function listSessionChildren(parentId: string, parentPath: string): Promise<SessionInfo[]> {
  if (!regularStoredFile(parentPath) || readSessionHeader(parentPath)?.id !== parentId) return [];
  const references = new Map<string, SessionReference>();
  const currentReferences = new Map<string, SessionReference>();
  for (const entry of openSessionManager(parentPath).getBranch()) {
    if (entry.type !== 'message' || entry.message.role !== 'toolResult') continue;
    for (const [path, ref] of collectSessionReferences(entry.message.details)) references.set(path, { ...references.get(path), ...ref });
    for (const [path, ref] of referencedStatusMetadata(entry.message.details, parentId, parentPath)) currentReferences.set(path, { ...currentReferences.get(path), ...ref });
  }
  for (const [path, ref] of currentReferences) references.set(path, { ...references.get(path), ...ref });
  const paths = new Set<string>();
  const container = parentPath.slice(0, -'.jsonl'.length);
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
  // Explicit references also support plugins storing child sessions outside a session-owned container.
  for (const path of references.keys()) if (paths.size < MAX_CHILDREN && path !== parentPath && regularStoredFile(path)) paths.add(path);
  const sessions: SessionInfo[] = [];
  for (const path of paths) {
    if (!regularStoredFile(path)) continue;
    const ref = references.get(resolve(path));
    const owner = identifyContainedSession(path);
    if (!ref && owner?.id !== parentId) continue;
    const info = await readSessionInfo(path);
    if (!info || info.id === parentId || info.relation?.kind === 'fork') continue;
    const title = ref?.label ?? ref?.sessionName ?? info.displayName ?? ref?.agent;
    cacheSessionPath(info.id, path);
    sessions.push({ ...info, ...(title ? { displayName: title } : {}), parentSessionId: parentId,
      relation: { kind: 'subagent', parentSessionId: parentId,
        profile: ref?.agent ?? (info.relation?.kind === 'subagent' ? info.relation.profile : 'subagent'),
        description: title ?? 'subagent',
        status: ref?.status ?? (info.relation?.kind === 'subagent' ? info.relation.status : 'unknown') },
    });
  }
  return sessions.sort((a, b) => b.modified.localeCompare(a.modified));
}
