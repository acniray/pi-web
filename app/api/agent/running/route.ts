import { NextResponse } from "next/server";
import { getSessionListVersion } from "@/lib/session-reader";
import {
  getAwaitingInputRpcSessionIds,
  getCompletionNotificationSuppressedRpcSessionIds,
  getRunningRpcSessionIds,
} from "@/lib/rpc-manager";
import { getWorkingSubagentSessionIds } from "@/lib/subagent-work";
import { getSessionUiStateRevision } from "@/lib/session-ui-state";

export const dynamic = "force-dynamic";

// GET /api/agent/running - Lightweight snapshot for visible-tab polling.
// sessionUiStateRevision (null when unreadable) tells the sidebar its pins and
// archive changed elsewhere; it costs one stat while the file is unchanged.
export async function GET() {
  const runningSessionIds = getRunningRpcSessionIds();
  // Work reported by extensions (a detached child still running), confirmed
  // against the children themselves and kept apart from runningSessionIds so
  // prompt/completion decisions stay on pi-web's own runs.
  const subagentWorkSessionIds = await getWorkingSubagentSessionIds(new Set(runningSessionIds));
  return NextResponse.json(
    {
      sessionListVersion: getSessionListVersion(),
      runningSessionIds,
      subagentWorkSessionIds,
      awaitingInputSessionIds: getAwaitingInputRpcSessionIds(),
      completionNotificationSuppressedSessionIds: getCompletionNotificationSuppressedRpcSessionIds(),
      sessionUiStateRevision: getSessionUiStateRevision(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
