import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { closeSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { SessionInfo } from "./types";

const MAX_HEADER_BYTES = 64 * 1024;
const MAX_CONTAINER_DEPTH = 8;
/** Container layouts nest as `<project>/<parent>/<run>/session.jsonl`. */
const MAX_WALK_DEPTH = 8;
const MAX_WALK_ENTRIES = 20_000;
/** `<timestamp>_<id>.jsonl` is the canonical name Pi itself writes. */
const CANONICAL_SESSION_NAME = /_([^/\\]+)\.jsonl$/;

export interface StoredSessionOwner {
  id: string;
  path: string;
  cwd: string;
}

type StoredHeader = StoredSessionOwner & { parentSession?: string };

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

/** The configured Pi session store, as an absolute path. */
export function storedSessionsRoot(): string {
  return resolve(getAgentDir(), "sessions");
}

/** Only regular JSONL files inside the configured Pi session store qualify. */
export function isRegularStoredSessionFile(filePath: string): boolean {
  if (!isAbsolute(filePath) || !filePath.endsWith(".jsonl")) return false;
  try {
    const root = realpathSync(storedSessionsRoot());
    const real = realpathSync(filePath);
    const stat = lstatSync(filePath);
    return isInside(root, real) && stat.isFile() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

/** Read one complete JSONL header; never load the transcript to infer identity. */
function readStoredHeader(filePath: string): StoredHeader | null {
  if (!isRegularStoredSessionFile(filePath)) return null;
  let fd: number | undefined;
  try {
    fd = openSync(filePath, "r");
    const buffer = Buffer.allocUnsafe(MAX_HEADER_BYTES);
    const bytes = readSync(fd, buffer, 0, buffer.length, 0);
    const newline = buffer.subarray(0, bytes).indexOf(0x0a);
    if (newline < 0) return null;
    const record: unknown = JSON.parse(buffer.subarray(0, newline).toString("utf8"));
    if (!record || typeof record !== "object") return null;
    const header = record as Record<string, unknown>;
    if (header.type !== "session" || typeof header.id !== "string" || !header.id ||
        typeof header.cwd !== "string") return null;
    return {
      id: header.id,
      path: filePath,
      cwd: header.cwd,
      ...(typeof header.parentSession === "string" ? { parentSession: header.parentSession } : {}),
    };
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * A Pi fork and an extension-owned child both record parentSession.
 * A child is recognized only when its declared parent matches a real
 * containing session's sibling JSONL, never from a path or tool label alone.
 * Native pi-web:subagent metadata is handled by the caller with priority.
 */
export function identifyContainedSession(filePath: string): StoredSessionOwner | null {
  if (!isRegularStoredSessionFile(filePath)) return null;
  let child: StoredHeader | null | undefined;
  const store = storedSessionsRoot();
  for (let dir = dirname(resolve(filePath)), depth = 0;
    depth < MAX_CONTAINER_DEPTH && isInside(store, dir);
    depth++) {
    const parentPath = `${dir}.jsonl`;
    // Keep imported calls out of the for-update expression: Turbopack 16.3.8
    // leaves dirname unbound there. Advance before any continue, as before.
    dir = dirname(dir);
    const parent = readStoredHeader(parentPath);
    if (!parent) continue;
    child ??= readStoredHeader(filePath);
    if (!child || !child.parentSession || !isAbsolute(child.parentSession)) return null;
    try {
      if (realpathSync(child.parentSession) !== realpathSync(parentPath)) continue;
    } catch {
      continue;
    }
    return { id: parent.id, path: parentPath, cwd: parent.cwd };
  }
  return null;
}

/**
 * Why a candidate is not the wanted session. The distinction matters because
 * "not this file" and "this file plus another one" need different answers:
 * the first keeps walking, the second forbids choosing a winner.
 */
const NOT_A_CANDIDATE = 0;
const CANDIDATE = 1;

function classifySessionCandidate(filePath: string, sessionId: string): number {
  const name = filePath.slice(filePath.lastIndexOf(sep) + 1);
  // Canonical names carry the id, so a mismatch rules the file out without
  // reading it. This keeps the walk cheap: one header read per real hit.
  const named = CANONICAL_SESSION_NAME.exec(name);
  if (named && named[1] !== sessionId) return NOT_A_CANDIDATE;
  const header = readStoredHeader(filePath);
  if (header) return header.id === sessionId ? CANDIDATE : NOT_A_CANDIDATE;
  // Container children are named `session.jsonl`, so only the header can tell
  // whether one belongs to this id — and an unreadable file cannot claim it.
  return NOT_A_CANDIDATE;
}

/**
 * Bounded discovery of one session file anywhere in the store. It exists for
 * the cold start after a server restart, when the path index is empty: without
 * it a nested child session cannot be opened by id or link until something
 * else lists it. Discovery walks at most MAX_WALK_ENTRIES entries and
 * MAX_WALK_DEPTH levels, never follows symlinks and never leaves the store.
 */
export async function findStoredSessionFile(sessionId: string): Promise<string | null> {
  if (!sessionId || sessionId.includes("/") || sessionId.includes("\\") || sessionId === "." || sessionId === "..") {
    return null;
  }
  const store = storedSessionsRoot();
  const queue: Array<{ dir: string; depth: number }> = [{ dir: store, depth: 0 }];
  let visited = 0;
  let truncated = false;
  let match: string | null = null;
  while (queue.length) {
    const current = queue.shift()!;
    let entries: Dirent[];
    try {
      entries = await readdir(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (visited >= MAX_WALK_ENTRIES) { truncated = true; break; }
      visited++;
      // Symlinks stay out: an outside link must never become a session path.
      if (entry.isSymbolicLink()) continue;
      const path = join(current.dir, entry.name);
      if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        const verdict = classifySessionCandidate(path, sessionId);
        if (verdict === NOT_A_CANDIDATE) continue;
        // Two files cannot both be the session; let the caller fall back to
        // its own catalogue rather than picking one arbitrarily.
        if (match && resolve(match) !== resolve(path)) return null;
        match = path;
      } else if (entry.isDirectory() && current.depth < MAX_WALK_DEPTH) {
        queue.push({ dir: path, depth: current.depth + 1 });
      }
    }
    if (truncated) break;
  }
  // An incomplete walk proves nothing, so a match from a truncated search is
  // discarded rather than reported as the only answer.
  return truncated ? null : match;
}

/**
 * Single relation decision for the catalogue, the detail API and the child
 * panel. Native `pi-web:subagent` metadata always wins; when no metadata is
 * present, ownership is only claimed through a real containing session. A
 * declared `parentSession` alone stays a Fork — an ordinary user Fork records
 * one exactly like an extension-owned child does.
 */
export function resolveSessionOwnership(session: SessionInfo): {
  owner: StoredSessionOwner | null;
  relation: SessionInfo["relation"];
} {
  if (session.relation?.kind === "subagent" || !session.path) {
    return { owner: null, relation: session.relation };
  }
  const owner = identifyContainedSession(session.path);
  if (!owner) return { owner: null, relation: session.relation };
  return {
    owner,
    relation: {
      kind: "subagent",
      parentSessionId: owner.id,
      profile: "subagent",
      description: session.name ?? "subagent",
      status: "unknown",
    },
  };
}
