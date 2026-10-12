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

/** The running subset of the same ids; changes only when a member's run state does. */
export function runningFamilyKey(
  ids: Iterable<string>,
  runningIds: ReadonlySet<string>,
): string {
  const running: string[] = [];
  for (const id of ids) if (runningIds.has(id)) running.push(id);
  return running.sort().join(",");
}
