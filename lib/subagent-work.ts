import { hasRunningSessionChild } from "./session-children";
import { getActiveWorkSessions } from "./session-liveness";

/** How long a verification is reused; the running poll asks every 2.5 s. */
export const SUBAGENT_WORK_CACHE_MS = 4_000;

interface WorkCacheEntry {
  expiresAt: number;
  working: boolean;
}

const WORK_CACHE_KEY = "@agegr/pi-web/subagent-work/v1";

function getWorkCache(): Map<string, WorkCacheEntry> {
  const store = globalThis as Record<PropertyKey, unknown>;
  const existing = store[WORK_CACHE_KEY];
  if (existing instanceof Map) return existing as Map<string, WorkCacheEntry>;
  const cache = new Map<string, WorkCacheEntry>();
  store[WORK_CACHE_KEY] = cache;
  return cache;
}

/**
 * Sessions an extension reports as busy, confirmed by the children they have.
 *
 * A liveness provider's `isActive()` answers "do not evict me", not "am I
 * working": pi-subagents also holds it while a finished run's result is still
 * owed, or a completion wake has not started — state that can outlast the work
 * by hours and would leave the session list spinning forever. The provider is
 * only the candidate list; the child rows (which read each run's status
 * document) decide. A candidate that cannot be verified is not claimed, and a
 * verification is reused briefly because every visible tab polls.
 */
export async function getWorkingSubagentSessionIds(
  runningIds: ReadonlySet<string>,
): Promise<string[]> {
  const candidates = getActiveWorkSessions().filter((session) => (
    session.sessionFile !== undefined && !runningIds.has(session.sessionId)
  ));
  if (candidates.length === 0) return [];

  const cache = getWorkCache();
  const working: string[] = [];
  await Promise.all(candidates.map(async ({ sessionId, sessionFile }) => {
    const now = Date.now();
    const cached = cache.get(sessionId);
    if (cached && cached.expiresAt > now) {
      if (cached.working) working.push(sessionId);
      return;
    }
    let verified = false;
    try {
      verified = await hasRunningSessionChild(sessionId, sessionFile!);
    } catch {
      // An unreadable child list proves nothing; do not claim work from it.
      verified = false;
    }
    cache.set(sessionId, { expiresAt: Date.now() + SUBAGENT_WORK_CACHE_MS, working: verified });
    if (verified) working.push(sessionId);
  }));
  return working;
}
