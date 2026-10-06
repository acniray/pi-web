"use client";

import { useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { SessionInfo, SubagentSessionStatus } from "@/lib/types";
import type {
  NicobailonAsyncNode,
  NicobailonAsyncSnapshot,
  NicobailonAsyncState,
} from "@/lib/nicobailon-async-snapshot";

interface Props {
  rootSession: SessionInfo;
  subagents: SessionInfo[];
  selectedSessionId: string;
  runningSessionIds: ReadonlySet<string>;
  workflowSnapshot?: NicobailonAsyncSnapshot | null;
  onSelectSession: (session: SessionInfo) => void;
}

function sessionTitle(session: SessionInfo): string {
  return session.name || session.firstMessage || session.id.slice(0, 12);
}

function formatRelativeTime(value: string, locale: string): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "";
  const elapsedSeconds = Math.round((timestamp - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (Math.abs(elapsedSeconds) < 60) return formatter.format(elapsedSeconds, "second");
  const elapsedMinutes = Math.round(elapsedSeconds / 60);
  if (Math.abs(elapsedMinutes) < 60) return formatter.format(elapsedMinutes, "minute");
  const elapsedHours = Math.round(elapsedMinutes / 60);
  if (Math.abs(elapsedHours) < 24) return formatter.format(elapsedHours, "hour");
  return formatter.format(Math.round(elapsedHours / 24), "day");
}

function statusColor(status: SubagentSessionStatus): string {
  if (status === "running" || status === "starting") return "var(--accent)";
  if (status === "completed") return "#16a34a";
  if (status === "failed") return "#dc2626";
  if (status === "aborted") return "#d97706";
  return "var(--text-dim)";
}

function StatusIcon({ status }: { status: SubagentSessionStatus }) {
  if (status === "running" || status === "starting") {
    return (
      <svg className="animate-spin" width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.25" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }
  if (status === "failed") {
    return (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" /><path d="m9 9 6 6M15 9l-6 6" />
      </svg>
    );
  }
  if (status === "aborted" || status === "interrupted") {
    return (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" /><path d="M9 9h6v6H9z" />
      </svg>
    );
  }
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" />
    </svg>
  );
}

function workflowStatusToSessionStatus(state: NicobailonAsyncState): SubagentSessionStatus {
  if (state === "running") return "running";
  if (state === "queued") return "starting";
  if (state === "complete") return "completed";
  if (state === "failed" || state === "rejected") return "failed";
  if (state === "stopped") return "aborted";
  return "interrupted";
}

function formatDurationMs(startedAt?: number, endedAt?: number): string {
  if (startedAt === undefined) return "";
  const end = endedAt ?? Date.now();
  const totalSeconds = Math.max(0, Math.floor((end - startedAt) / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function WorkflowNodeRow({ node, depth = 0 }: { node: NicobailonAsyncNode; depth?: number }) {
  const { t } = useI18n();
  const mappedStatus = workflowStatusToSessionStatus(node.state);
  const duration = formatDurationMs(node.startedAt, node.endedAt);
  const activity = node.activity?.currentTool;
  return (
    <div>
      <div
        style={{
          minHeight: 34,
          display: "grid",
          gridTemplateColumns: "18px minmax(0, 1fr) auto",
          alignItems: "center",
          gap: 7,
          padding: `5px 10px 5px ${24 + depth * 14}px`,
          borderTop: "1px solid color-mix(in srgb, var(--border) 72%, transparent)",
          color: "var(--text)",
        }}
      >
        <span style={{ display: "grid", placeItems: "center", color: statusColor(mappedStatus) }}>
          <StatusIcon status={mappedStatus} />
        </span>
        <span style={{ minWidth: 0 }}>
          <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11.5, fontWeight: 500 }} title={node.label}>
            {node.label}
          </span>
          {(activity || duration) && (
            <span style={{ display: "block", marginTop: 1, color: "var(--text-dim)", fontSize: 10.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {[activity, duration].filter(Boolean).join(" · ")}
            </span>
          )}
        </span>
        <span style={{ color: statusColor(mappedStatus), fontSize: 10.5, whiteSpace: "nowrap" }}>
          {t(`agentSwitcher.workflowStatus.${node.state}`)}
        </span>
      </div>
      {node.children?.map((child) => (
        <WorkflowNodeRow key={child.id} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}

function WorkflowRunCard({ run, generatedAt }: { run: NicobailonAsyncNode; generatedAt: number }) {
  const { locale, t } = useI18n();
  const mappedStatus = workflowStatusToSessionStatus(run.state);
  const updated = formatRelativeTime(new Date(generatedAt).toISOString(), locale);
  const duration = formatDurationMs(run.startedAt, run.endedAt);
  const childCount = run.children?.length ?? 0;

  return (
    <details
      defaultOpen={run.state === "running" || run.state === "queued"}
      style={{
        borderBottom: "1px solid var(--border)",
        background: run.state === "running"
          ? "color-mix(in srgb, var(--accent) 4%, transparent)"
          : "transparent",
      }}
    >
      <summary
        style={{
          minHeight: 48,
          display: "grid",
          gridTemplateColumns: "24px minmax(0, 1fr) auto",
          alignItems: "center",
          gap: 8,
          padding: "6px 12px",
          cursor: "pointer",
          listStyle: "none",
        }}
      >
        <span style={{ width: 24, height: 24, display: "grid", placeItems: "center", color: statusColor(mappedStatus) }}>
          <StatusIcon status={mappedStatus} />
        </span>
        <span style={{ minWidth: 0 }}>
          <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, fontWeight: 600 }} title={run.label}>
            {run.kind === "workflow" ? t("agentSwitcher.workflow") : t("agentSwitcher.run")} · {run.label}
          </span>
          <span style={{ display: "block", marginTop: 2, color: "var(--text-dim)", fontSize: 10.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {[
              childCount > 0 ? t("agentSwitcher.stepCount", { count: childCount }) : null,
              duration || null,
              t("agentSwitcher.updated", { time: updated }),
            ].filter(Boolean).join(" · ")}
          </span>
        </span>
        <span style={{ color: statusColor(mappedStatus), fontSize: 10.5, whiteSpace: "nowrap" }}>
          {t(`agentSwitcher.workflowStatus.${run.state}`)}
        </span>
      </summary>
      {run.children?.map((child) => (
        <WorkflowNodeRow key={child.id} node={child} />
      ))}
    </details>
  );
}

function countRunningWorkflowLeaves(nodes: readonly NicobailonAsyncNode[]): number {
  return nodes.reduce((total, node) => {
    if (node.children?.length) return total + countRunningWorkflowLeaves(node.children);
    return total + (node.state === "running" ? 1 : 0);
  }, 0);
}

function AgentRow({
  session,
  main,
  selected,
  running,
  onSelect,
}: {
  session: SessionInfo;
  main?: boolean;
  selected: boolean;
  running: boolean;
  onSelect: () => void;
}) {
  const { locale, t } = useI18n();
  const relation = session.relation?.kind === "subagent" ? session.relation : null;
  const status: SubagentSessionStatus = running ? "running" : relation?.status ?? "completed";
  const primary = main ? t("agentSwitcher.main") : relation?.description || sessionTitle(session);
  const secondary = main
    ? sessionTitle(session)
    : `${relation?.profile ?? t("agentSwitcher.subagent")} · ${formatRelativeTime(session.modified, locale)}`;

  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      style={{
        width: "100%",
        minHeight: 56,
        display: "grid",
        gridTemplateColumns: "28px minmax(0, 1fr) auto",
        alignItems: "center",
        gap: 9,
        padding: "7px 12px",
        border: "none",
        borderBottom: "1px solid var(--border)",
        borderLeft: selected ? "2px solid var(--accent)" : "2px solid transparent",
        background: selected ? "var(--bg-selected)" : "transparent",
        color: "var(--text)",
        cursor: "pointer",
        textAlign: "left",
      }}
      onMouseEnter={(event) => {
        if (!selected) event.currentTarget.style.background = "var(--bg-hover)";
      }}
      onMouseLeave={(event) => {
        if (!selected) event.currentTarget.style.background = "transparent";
      }}
    >
      <span style={{ width: 28, height: 28, display: "grid", placeItems: "center", color: main ? "var(--text-muted)" : "var(--accent)" }}>
        {main ? (
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" />
          </svg>
        ) : (
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="5" y="7" width="14" height="11" rx="2" /><path d="M9 11h.01M15 11h.01M9 15h6M12 7V4M10 4h4" />
          </svg>
        )}
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, fontWeight: selected ? 600 : 500 }} title={primary}>
          {primary}
        </span>
        <span style={{ display: "block", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-dim)", fontSize: 11 }} title={secondary}>
          {secondary}
        </span>
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: 6, color: main && !running ? "var(--text-dim)" : statusColor(status), fontSize: 11, whiteSpace: "nowrap" }}>
        {main && !running ? (
          selected ? t("agentSwitcher.current") : null
        ) : (
          <>
            <StatusIcon status={status} />
            <span>{t(`agentSwitcher.status.${status}`)}</span>
          </>
        )}
      </span>
    </button>
  );
}

export function AgentSessionPanel({ rootSession, subagents, selectedSessionId, runningSessionIds, workflowSnapshot, onSelectSession }: Props) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const sortedSubagents = useMemo(() => [...subagents].sort((a, b) => {
    const aRunning = runningSessionIds.has(a.id);
    const bRunning = runningSessionIds.has(b.id);
    if (aRunning !== bRunning) return aRunning ? -1 : 1;
    return b.modified.localeCompare(a.modified);
  }), [runningSessionIds, subagents]);
  const normalizedQuery = query.trim().toLowerCase();
  const visibleSubagents = normalizedQuery
    ? sortedSubagents.filter((session) => {
        const relation = session.relation?.kind === "subagent" ? session.relation : null;
        return [relation?.description, relation?.profile, session.name, session.firstMessage]
          .some((value) => value?.toLowerCase().includes(normalizedQuery));
      })
    : sortedSubagents;
  const runningCount = subagents.filter((session) => runningSessionIds.has(session.id)).length;
  const workflowRuns = workflowSnapshot?.runs ?? [];
  const workflowRunningCount = countRunningWorkflowLeaves(workflowRuns);
  const displayedRunningCount = Math.max(runningCount, workflowRunningCount);

  return (
    <div
      role="listbox"
      aria-label={t("agentSwitcher.title")}
      style={{
        background: "var(--bg-panel)",
        borderLeft: "1px solid var(--border)",
        borderRight: "1px solid var(--border)",
        borderBottom: "1px solid var(--border)",
        borderRadius: "0 0 6px 6px",
        boxShadow: "0 10px 28px rgba(0,0,0,0.10)",
        overflow: "hidden",
      }}
    >
      <div>
        <div style={{ minHeight: 44, display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", borderBottom: "1px solid var(--border)" }}>
          <strong style={{ fontSize: 12, fontWeight: 600 }}>{t("agentSwitcher.title")}</strong>
          <span style={{ color: "var(--text-dim)", fontSize: 11 }}>
            {t("agentSwitcher.count", { count: subagents.length })}
          </span>
          {displayedRunningCount > 0 && (
            <span style={{ marginLeft: "auto", color: "var(--accent)", fontSize: 11 }}>
              {t("agentSwitcher.runningCount", { count: displayedRunningCount })}
            </span>
          )}
        </div>
        {subagents.length > 8 && (
          <div style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("agentSwitcher.search")}
              aria-label={t("agentSwitcher.search")}
              style={{
                width: "100%", height: 32, padding: "0 10px",
                border: "1px solid var(--border)", borderRadius: 6,
                background: "var(--bg)", color: "var(--text)", fontSize: 12, outline: "none",
              }}
            />
          </div>
        )}
        <div style={{ maxHeight: "min(58dvh, 480px)", overflowY: "auto" }}>
          <AgentRow
            session={rootSession}
            main
            selected={rootSession.id === selectedSessionId}
            running={runningSessionIds.has(rootSession.id)}
            onSelect={() => onSelectSession(rootSession)}
          />
          {workflowRuns.length > 0 && (
            <div aria-label={t("agentSwitcher.workflows")}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, minHeight: 28, padding: "5px 12px", borderBottom: "1px solid var(--border)", background: "var(--bg-subtle)", color: "var(--text-muted)", fontSize: 10.5, fontWeight: 600 }}>
                <span>{t("agentSwitcher.workflows")}</span>
                <span style={{ color: "var(--text-dim)", fontWeight: 500 }}>{workflowRuns.length}</span>
              </div>
              {workflowRuns.map((run) => (
                <WorkflowRunCard key={run.id} run={run} generatedAt={workflowSnapshot!.generatedAt} />
              ))}
            </div>
          )}
          {workflowRuns.length > 0 && visibleSubagents.length > 0 && (
            <div style={{ minHeight: 28, display: "flex", alignItems: "center", padding: "5px 12px", borderBottom: "1px solid var(--border)", background: "var(--bg-subtle)", color: "var(--text-muted)", fontSize: 10.5, fontWeight: 600 }}>
              {t("agentSwitcher.sessions")}
            </div>
          )}
          {visibleSubagents.map((session) => (
            <AgentRow
              key={session.id}
              session={session}
              selected={session.id === selectedSessionId}
              running={runningSessionIds.has(session.id)}
              onSelect={() => onSelectSession(session)}
            />
          ))}
          {visibleSubagents.length === 0 && (
            <div style={{ padding: "22px 12px", color: "var(--text-dim)", fontSize: 12, textAlign: "center" }}>
              {t("agentSwitcher.noMatches")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
