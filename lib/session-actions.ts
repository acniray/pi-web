import type { PluginsResponse } from "./api-types";

export interface SessionArchiveActionResult {
  ok: boolean;
  archivedSessionIds: string[];
  failedSessionIds: string[];
  notifications: Array<{ message: string; type?: "info" | "warning" | "error" }>;
}

function isSessionArchiveExtensionName(name: string): boolean {
  return name === "pi-session-archive";
}

export async function hasSessionArchiveAction(cwd: string, signal?: AbortSignal): Promise<boolean> {
  const response = await fetch(`/api/plugins?cwd=${encodeURIComponent(cwd)}`, {
    cache: "no-store",
    signal,
  });
  if (!response.ok) return false;

  const plugins = await response.json() as PluginsResponse;
  if (plugins.standaloneExtensions.some((extension) =>
    extension.enabled && isSessionArchiveExtensionName(extension.name)
  )) {
    return true;
  }

  return plugins.packages.some((pkg) =>
    pkg.status === "loaded"
    && pkg.resources.some((resource) =>
      resource.kind === "extension" && isSessionArchiveExtensionName(resource.name)
    )
  );
}

export async function archiveSessionsWithExtension(
  cwd: string,
  sessionIds: readonly string[],
): Promise<SessionArchiveActionResult> {
  const response = await fetch("/api/session-actions/archive", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd, sessionIds }),
  });
  const data = await response.json() as Partial<SessionArchiveActionResult> & {
    error?: string;
    blockedSessionIds?: string[];
  };

  if (!response.ok) {
    const blocked = data.blockedSessionIds?.length
      ? ` (${data.blockedSessionIds.length} running)`
      : "";
    throw new Error(`${data.error ?? `HTTP ${response.status}`}${blocked}`);
  }

  return {
    ok: data.ok === true,
    archivedSessionIds: data.archivedSessionIds ?? [],
    failedSessionIds: data.failedSessionIds ?? [],
    notifications: data.notifications ?? [],
  };
}
