import { configureHttpDispatcher } from "@/lib/http-dispatcher";
import { closeAllAgentEventStreams } from "@/lib/agent-event-stream";
import { ensureNicobailonHostEnvironment } from "@/lib/nicobailon-config";

export function registerNodeInstrumentation(): void {
  // nicobailon/pi-subagents spawns detached children in a separate Node process.
  // Pi Web is a wrapper host, so give it the exact SDK package root before any
  // extension or session can initialize.
  ensureNicobailonHostEnvironment();
  configureHttpDispatcher();

  // In production Next 16 answers SIGINT/SIGTERM with server.close() and waits
  // for every connection to end, without a timeout. SSE streams only end when
  // the client disconnects, so close them here or the process never exits.
  const shutdownStreams = () => closeAllAgentEventStreams();
  process.on("SIGINT", shutdownStreams);
  process.on("SIGTERM", shutdownStreams);
}
