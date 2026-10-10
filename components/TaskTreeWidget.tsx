"use client";

import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import {
  countTaskTreeLeafStates,
  findTaskTreeNode,
  firstTaskTreeNode,
  type TaskTreeNode,
  type TaskTreeState,
  type TaskTreeWidgetModel,
} from "@/lib/extension-widget-model";

function stateGlyph(state: TaskTreeState): string {
  if (state === "running") return "●";
  if (state === "queued") return "○";
  if (state === "complete") return "✓";
  if (state === "failed" || state === "rejected") return "×";
  if (state === "paused") return "Ⅱ";
  if (state === "stopped") return "■";
  return "◐";
}

function collectDefaultExpanded(nodes: readonly TaskTreeNode[], target = new Set<string>()): Set<string> {
  for (const node of nodes) {
    if (node.children?.length && (node.state === "running" || node.state === "queued")) {
      target.add(node.key);
    }
    if (node.children?.length) collectDefaultExpanded(node.children, target);
  }
  return target;
}

function formatDuration(startedAt: number | undefined, endedAt: number | undefined): string | null {
  if (startedAt === undefined || endedAt === undefined) return null;
  const seconds = Math.max(0, Math.floor((endedAt - startedAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function NodeRow({
  node,
  depth,
  selectedId,
  expandedIds,
  onSelect,
  onToggle,
}: {
  node: TaskTreeNode;
  depth: number;
  selectedId: string | null;
  expandedIds: ReadonlySet<string>;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
}) {
  const { t } = useI18n();
  const hasChildren = Boolean(node.children?.length);
  const expanded = hasChildren && expandedIds.has(node.key);
  const selected = selectedId === node.key;
  const activity = node.activity?.currentTool ?? node.activity?.state;

  return (
    <>
      <div
        role="treeitem"
        aria-level={depth + 1}
        aria-selected={selected}
        aria-expanded={hasChildren ? expanded : undefined}
        className={`task-tree-row${selected ? " is-selected" : ""}`}
        data-state={node.state}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
      >
        <button
          type="button"
          className="task-tree-disclosure"
          aria-label={expanded ? t("taskTree.collapse") : t("taskTree.expand")}
          aria-expanded={hasChildren ? expanded : undefined}
          disabled={!hasChildren}
          onClick={() => hasChildren && onToggle(node.key)}
        >
          {hasChildren ? (expanded ? "▾" : "▸") : ""}
        </button>
        <button
          type="button"
          className="task-tree-row-main"
          onClick={() => onSelect(node.key)}
          aria-pressed={selected}
        >
          <span className="task-tree-state-glyph" aria-hidden="true">{stateGlyph(node.state)}</span>
          <span className="task-tree-row-label" title={node.label}>{node.label}</span>
          {activity && <span className="task-tree-row-activity" title={activity}>{activity}</span>}
          <span className="task-tree-row-state">{t(`taskTree.state.${node.state}`)}</span>
        </button>
      </div>
      {expanded && node.children?.map((child) => (
        <NodeRow
          key={child.key}
          node={child}
          depth={depth + 1}
          selectedId={selectedId}
          expandedIds={expandedIds}
          onSelect={onSelect}
          onToggle={onToggle}
        />
      ))}
    </>
  );
}

function DetailItem({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="task-tree-detail-item">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function taskTreeSummaryParts(model: TaskTreeWidgetModel): Array<{ state: TaskTreeState; count: number }> {
  const counts = countTaskTreeLeafStates(model.nodes);
  return (["running", "queued", "failed", "rejected", "partial", "paused", "stopped", "complete"] as const)
    .map((state) => ({ state, count: counts[state] }))
    .filter(({ count }) => count > 0);
}

export function TaskTreeWidget({ model }: { model: TaskTreeWidgetModel }) {
  const { locale, t } = useI18n();
  const first = firstTaskTreeNode(model.nodes);
  const [selectedId, setSelectedId] = useState<string | null>(() => first?.key ?? null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () => collectDefaultExpanded(model.nodes),
  );

  useEffect(() => {
    if (!findTaskTreeNode(model.nodes, selectedId)) {
      setSelectedId(firstTaskTreeNode(model.nodes)?.key ?? null);
    }
    setExpandedIds((current) => {
      const next = new Set(current);
      for (const id of collectDefaultExpanded(model.nodes)) next.add(id);
      return next;
    });
  }, [model.nodes, selectedId]);

  const selected = useMemo(
    () => findTaskTreeNode(model.nodes, selectedId),
    [model.nodes, selectedId],
  );
  const summary = taskTreeSummaryParts(model);
  const detailEnd = selected?.endedAt ?? model.generatedAt;
  const duration = formatDuration(selected?.startedAt, detailEnd);
  const updated = selected?.updatedAt !== undefined
    ? new Date(selected.updatedAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : null;
  const omittedCount = (model.omitted?.nodes ?? 0) + (model.omitted?.children ?? 0);

  const toggle = (id: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="task-tree-widget">
      <div className="task-tree-header">
        <strong>{model.title}</strong>
        <span className="task-tree-summary">
          {summary.map(({ state, count }) => (
            <span key={state} data-state={state}>
              {count} {t(`taskTree.state.${state}`).toLowerCase()}
            </span>
          ))}
        </span>
      </div>

      <div className="task-tree-body">
        <div className="task-tree-list" role="tree" aria-label={model.title}>
          {model.nodes.map((node) => (
            <NodeRow
              key={node.key}
              node={node}
              depth={0}
              selectedId={selectedId}
              expandedIds={expandedIds}
              onSelect={setSelectedId}
              onToggle={toggle}
            />
          ))}
          {model.nodes.length === 0 && (
            <div className="task-tree-empty">{t("taskTree.empty")}</div>
          )}
          {omittedCount > 0 && (
            <div className="task-tree-omitted">
              {t("taskTree.omitted", { count: omittedCount })}
            </div>
          )}
        </div>

        <div className="task-tree-detail">
          {selected ? (
            <>
              <div className="task-tree-detail-heading">
                <span className="task-tree-state-glyph" data-state={selected.state} aria-hidden="true">
                  {stateGlyph(selected.state)}
                </span>
                <strong title={selected.label}>{selected.label}</strong>
                <span className="task-tree-detail-state" data-state={selected.state}>
                  {t(`taskTree.state.${selected.state}`)}
                </span>
              </div>
              <dl className="task-tree-detail-grid">
                <DetailItem label={t("taskTree.type")} value={selected.type} />
                <DetailItem label={t("taskTree.currentTool")} value={selected.activity?.currentTool} />
                <DetailItem label={t("taskTree.activity")} value={selected.activity?.state} />
                <DetailItem label={t("taskTree.turns")} value={selected.activity?.turnCount} />
                <DetailItem label={t("taskTree.tools")} value={selected.activity?.toolCount} />
                <DetailItem label={t("taskTree.duration")} value={duration} />
                <DetailItem label={t("taskTree.updated")} value={updated} />
                <DetailItem label={t("taskTree.children")} value={selected.children?.length} />
              </dl>
            </>
          ) : (
            <div className="task-tree-empty">{t("taskTree.select")}</div>
          )}
        </div>
      </div>
    </div>
  );
}
