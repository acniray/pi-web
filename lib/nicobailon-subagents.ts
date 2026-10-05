import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { basename, dirname, join, sep } from "node:path";
import { scanSessionFileInfo, type ScannedSessionInfo } from "./session-list-scanner";
import { attachSessionProjectInfo, cacheSessionPath } from "./session-reader";
import type { SessionInfo } from "./types";

const MAX_NICOBAILON_CHILD_SESSIONS = 2_000;

type CachedChild = {
  size: number;
  mtimeMs: number;
  info: ScannedSessionInfo | null;
};

declare global {
  var __piWebNicobailonChildSessionCache: Map<string, CachedChild> | undefined;
}

function childCache(): Map<string, CachedChild> {
  if (!globalThis.__piWebNicobailonChildSessionCache) {
    globalThis.__piWebNicobailonChildSessionCache = new Map();
  }
  return globalThis.__piWebNicobailonChildSessionCache;
}

/** For ".../abc.jsonl", nicobailon stores child runs below ".../abc/". */
export function nicobailonChildSessionRoot(parentSessionPath: string): string {
  const parentName = basename(parentSessionPath);
  const stem = parentName.toLowerCase().endsWith(".jsonl")
    ? parentName.slice(0, -".jsonl".length)
    : parentName;
  return join(dirname(parentSessionPath), stem);
}

async function candidateSessionFiles(root: string): Promise<string[]> {
  let launchDirs: Dirent[];
  try {
    launchDirs = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const launchDir of launchDirs) {
    if (!launchDir.isDirectory() || launchDir.name === "forks") continue;
    const launchPath = join(root, launchDir.name);
    let entries: Dirent[];
    try {
      entries = await readdir(launchPath, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^run-\d+$/.test(entry.name)) continue;
      files.push(join(launchPath, entry.name, "session.jsonl"));
      if (files.length >= MAX_NICOBAILON_CHILD_SESSIONS) return files;
    }
  }
  return files;
}

async function scanCached(filePath: string): Promise<ScannedSessionInfo | null> {
  let fingerprint;
  try {
    fingerprint = await stat(filePath);
    if (!fingerprint.isFile()) return null;
  } catch {
    return null;
  }

  const cache = childCache();
  const cached = cache.get(filePath);
  if (cached && cached.size === fingerprint.size && cached.mtimeMs === fingerprint.mtimeMs) {
    return cached.info;
  }
  const info = await scanSessionFileInfo(filePath);
  cache.set(filePath, { size: fingerprint.size, mtimeMs: fingerprint.mtimeMs, info });
  return info;
}

function displayParts(info: ScannedSessionInfo): { profile: string; description: string } {
  const name = info.name?.trim() ?? "";
  const separator = name.indexOf(":");
  const profile = (separator > 0 ? name.slice(0, separator) : name).trim() || "subagent";
  const namedDescription = separator > 0 ? name.slice(separator + 1).trim() : "";
  const fallback = info.firstMessage && info.firstMessage !== "(no messages)"
    ? info.firstMessage
    : name || profile;
  return { profile, description: namedDescription || fallback };
}

/**
 * Discover only one parent's nicobailon children. The global session scanner
 * stays non-recursive so high-fan-out workers never become top-level rows.
 */
export async function listNicobailonChildSessions(
  parentSessionId: string,
  parentSessionPath: string,
): Promise<SessionInfo[]> {
  const root = nicobailonChildSessionRoot(parentSessionPath);
  const candidates = await candidateSessionFiles(root);
  const present = new Set(candidates);
  const cache = childCache();
  const rootPrefix = root.endsWith(sep) ? root : `${root}${sep}`;
  for (const path of cache.keys()) {
    if (path.startsWith(rootPrefix) && !present.has(path)) cache.delete(path);
  }

  const sessions: SessionInfo[] = [];
  const seenIds = new Set<string>();
  for (const filePath of candidates) {
    const info = await scanCached(filePath);
    if (!info || seenIds.has(info.id)) continue;
    seenIds.add(info.id);
    cacheSessionPath(info.id, info.path);
    const { profile, description } = displayParts(info);
    sessions.push({
      path: info.path,
      id: info.id,
      cwd: info.cwd,
      name: info.name,
      created: info.created.toISOString(),
      modified: info.modified.toISOString(),
      messageCount: info.messageCount,
      firstMessage: info.firstMessage || "(no messages)",
      parentSessionId,
      relation: {
        kind: "subagent",
        parentSessionId,
        profile,
        description,
        status: "completed",
      },
      transient: false,
    });
  }

  sessions.sort((a, b) => b.modified.localeCompare(a.modified));
  return attachSessionProjectInfo(sessions);
}
