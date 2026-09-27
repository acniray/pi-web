import { NextResponse } from "next/server";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import {
  invalidateSessionListCache,
  invalidateSessionManagerCache,
  invalidateSessionPathCache,
  listAllSessions,
} from "@/lib/session-reader";
import {
  getRpcSession,
  getRpcSessionInfos,
  runTransientExtensionCommand,
} from "@/lib/rpc-manager";
import type { SessionInfo } from "@/lib/types";

export const dynamic = "force-dynamic";

function mergeById(disk: readonly SessionInfo[], runtime: readonly SessionInfo[]): SessionInfo[] {
  const byId = new Map<string, SessionInfo>();
  for (const session of disk) byId.set(session.id, session);
  for (const session of runtime) byId.set(session.id, { ...byId.get(session.id), ...session });
  return [...byId.values()];
}

function familyIds(rootId: string, sessions: readonly SessionInfo[]): Set<string> {
  const children = new Map<string, string[]>();
  for (const session of sessions) {
    if (session.relation?.kind !== "subagent") continue;
    const current = children.get(session.relation.parentSessionId) ?? [];
    current.push(session.id);
    children.set(session.relation.parentSessionId, current);
  }

  const ids = new Set<string>([rootId]);
  const pending = [rootId];
  while (pending.length > 0) {
    const parent = pending.pop()!;
    for (const child of children.get(parent) ?? []) {
      if (ids.has(child)) continue;
      ids.add(child);
      pending.push(child);
    }
  }
  return ids;
}

export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  try {
    const body = await req.json() as { cwd?: unknown; sessionIds?: unknown };
    const cwd = typeof body.cwd === "string" ? body.cwd : "";
    const sessionIds = Array.isArray(body.sessionIds)
      ? [...new Set(body.sessionIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0).map((id) => id.trim()))]
      : [];

    if (!cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });
    if (sessionIds.length === 0) return NextResponse.json({ error: "sessionIds required" }, { status: 400 });

    const allowedRoots = await getAllowedFileRoots();
    if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const sessions = mergeById(
      await listAllSessions({ force: true }),
      getRpcSessionInfos({ includeTransient: true }),
    );
    const byId = new Map(sessions.map((session) => [session.id, session]));
    const targetFamilies = sessionIds.map((rootId) => ({
      rootId,
      ids: familyIds(rootId, sessions),
    }));

    const missing = sessionIds.filter((id) => !byId.has(id));
    if (missing.length > 0) {
      return NextResponse.json({ error: "Session not found", missing }, { status: 404 });
    }

    const running = new Set<string>();
    for (const family of targetFamilies) {
      for (const id of family.ids) {
        if (getRpcSession(id)?.isRunning()) running.add(id);
      }
    }
    if (running.size > 0) {
      return NextResponse.json(
        { error: "Running sessions cannot be archived", blockedSessionIds: [...running] },
        { status: 409 },
      );
    }

    // An idle wrapper still owns an append path. Shut it down before moving the
    // JSONL so a later write cannot recreate the active copy.
    const familyIdsToClose = new Set(targetFamilies.flatMap((family) => [...family.ids]));
    for (const id of familyIdsToClose) {
      const wrapper = getRpcSession(id);
      if (wrapper?.isAlive()) await wrapper.shutdown();
    }

    const result = await runTransientExtensionCommand(
      cwd,
      "archive",
      `--ids ${sessionIds.join(",")}`,
    );
    if (!result.available) {
      return NextResponse.json(
        { error: "Session archive extension is not available" },
        { status: 409 },
      );
    }

    for (const id of familyIdsToClose) {
      const path = byId.get(id)?.path;
      invalidateSessionPathCache(id);
      if (path) invalidateSessionManagerCache(path);
    }
    invalidateSessionListCache();

    const remaining = new Set((await listAllSessions({ force: true })).map((session) => session.id));
    const archivedSessionIds = sessionIds.filter((id) => !remaining.has(id));
    const failedSessionIds = sessionIds.filter((id) => remaining.has(id));

    return NextResponse.json({
      ok: failedSessionIds.length === 0,
      archivedSessionIds,
      failedSessionIds,
      notifications: result.notifications,
    }, { status: failedSessionIds.length === 0 ? 200 : 409 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
