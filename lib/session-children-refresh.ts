import type { SessionInfo } from './types';
import { sessionIsRunning } from './session-display';

/**
 * Polling policy for a selected session's child list.
 *
 * The panel used to re-read the parent's branch and re-walk its container every
 * five seconds for as long as it was open, whether or not anything could have
 * changed. The decision is kept here as a pure value so a caller only consumes
 * it: refresh on a real change, and poll only while a member of the shown
 * family is actually running.
 */
export const CHILDREN_RUNNING_POLL_MS = 4_000;

/**
 * The running subset of the shown family, keyed the same way the panel decides
 * whether a row is running (`sessionIsRunning`). A detached child an extension
 * runs has no live web runtime of its own, so its relation status is the only
 * signal that it is still working — reading one scheme here and another in the
 * row is what let such a family stop being polled before it finished.
 */
export function runningFamilyKey(
  sessions: Iterable<Pick<SessionInfo, "id" | "relation">>,
  runningIds: ReadonlySet<string>,
): string {
  const running: string[] = [];
  for (const session of sessions) {
    if (sessionIsRunning(session, runningIds)) running.push(session.id);
  }
  return running.sort().join(",");
}
