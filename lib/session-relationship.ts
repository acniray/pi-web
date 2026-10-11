import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { closeSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { SessionInfo } from "./types";

const MAX_HEADER_BYTES = 64 * 1024;
const MAX_CONTAINER_DEPTH = 8;

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

/** Only regular JSONL files inside the configured Pi session store qualify. */
export function isRegularStoredSessionFile(filePath: string): boolean {
  if (!isAbsolute(filePath) || !filePath.endsWith(".jsonl")) return false;
  try {
    const root = realpathSync(join(getAgentDir(), "sessions"));
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
  const store = resolve(getAgentDir(), "sessions");
  for (let dir = dirname(resolve(filePath)), depth = 0;
    depth < MAX_CONTAINER_DEPTH && isInside(store, dir);
    dir = dirname(dir), depth++) {
    const parentPath = `${dir}.jsonl`;
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

/** Single relation decision for the catalogue, detail API and child list. */
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
