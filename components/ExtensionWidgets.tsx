"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { AnsiText } from "@/components/AnsiText";
import type { ExtensionWidgetItem } from "@/lib/types";
import { toTerminalKeyData } from "@/lib/terminal-input";
import { resolveExtensionWidgetPresentation } from "@/lib/extension-widget-adapters";
import { TaskTreeWidget, taskTreeSummaryParts } from "./TaskTreeWidget";

export const DEFAULT_EXPANDED_WIDGET_LINES = 3;
export const WIDGET_UPDATE_IDLE_MS = 1100;

export function formatExtensionWidgetContent(lines: string[]): string {
  return lines.join("\n");
}

export function snapshotExtensionWidgetContents(
  widgets: ExtensionWidgetItem[],
): Map<string, string[]> {
  return new Map(widgets.map((widget) => [widget.key, [...widget.lines]]));
}

export function getUpdatedExtensionWidgetKeys(
  previous: ReadonlyMap<string, readonly string[]> | null,
  next: ReadonlyMap<string, readonly string[]>,
): string[] {
  if (!previous) return [];
  return Array.from(next, ([key, lines]) => {
    const previousLines = previous.get(key);
    if (!previousLines || previousLines.length !== lines.length) {
      return previousLines ? key : null;
    }
    return lines.some((line, index) => line !== previousLines[index]) ? key : null;
  }).filter((key): key is string => key !== null);
}

function getDefaultExpandedWidgetKey(widgets: ExtensionWidgetItem[]): string | null {
  return widgets.find((widget) => {
    const lineCount = widget.lines.length;
    return lineCount > 0 && lineCount <= DEFAULT_EXPANDED_WIDGET_LINES && (lineCount > 1 || widget.interactive);
  })?.key ?? null;
}

export function getNextExpandedWidgetKey(
  currentKey: string | null,
  requestedKey: string,
): string | null {
  return currentKey === requestedKey ? null : requestedKey;
}

/**
 * `children` (the status line) joins the triggers in one row, so the whole row
 * scrolls sideways together; the expanded panel stays above it, out of the scroll.
 */
export function ExtensionWidgets({ widgets, children, onInput }: { widgets: ExtensionWidgetItem[]; children?: ReactNode; onInput?: (data: string) => Promise<void> | void }) {
  const { t } = useI18n();
  const idPrefix = useId();
  const previousContentsRef = useRef<Map<string, string[]> | null>(null);
  const updateClearTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [expandedWidgetKey, setExpandedWidgetKey] = useState<string | null>(
    () => getDefaultExpandedWidgetKey(widgets),
  );
  const [inputError, setInputError] = useState<string | null>(null);
  const inputPendingRef = useRef(false);
  const sendInput = async (data: string) => {
    if (!onInput || inputPendingRef.current) return;
    inputPendingRef.current = true;
    try { await onInput(data); setInputError(null); }
    catch (error) { setInputError(error instanceof Error ? error.message : String(error)); }
    finally { inputPendingRef.current = false; }
  };
  const [updatingWidgetKeys, setUpdatingWidgetKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const presentations = useMemo(() => new Map(widgets.map((widget) => [widget.key, resolveExtensionWidgetPresentation(widget)])), [widgets]);
  useEffect(() => {
    const nextContents = snapshotExtensionWidgetContents(widgets);
    const updatedKeys = getUpdatedExtensionWidgetKeys(
      previousContentsRef.current,
      nextContents,
    );
    previousContentsRef.current = nextContents;

    for (const [key, timer] of updateClearTimersRef.current) {
      if (nextContents.has(key)) continue;
      clearTimeout(timer);
      updateClearTimersRef.current.delete(key);
    }

    setUpdatingWidgetKeys((current) => {
      const next = new Set(Array.from(current).filter((key) => nextContents.has(key)));
      for (const key of updatedKeys) next.add(key);
      if (
        next.size === current.size
        && Array.from(next).every((key) => current.has(key))
      ) return current;
      return next;
    });

    for (const key of updatedKeys) {
      const currentTimer = updateClearTimersRef.current.get(key);
      if (currentTimer) clearTimeout(currentTimer);
      updateClearTimersRef.current.set(key, setTimeout(() => {
        updateClearTimersRef.current.delete(key);
        setUpdatingWidgetKeys((current) => {
          if (!current.has(key)) return current;
          const next = new Set(current);
          next.delete(key);
          return next;
        });
      }, WIDGET_UPDATE_IDLE_MS));
    }
  }, [widgets]);

  useEffect(() => () => {
    for (const timer of updateClearTimersRef.current.values()) clearTimeout(timer);
    updateClearTimersRef.current.clear();
  }, []);

  if (widgets.length === 0) return null;

  const expandedWidget = widgets.find((widget) => (
    widget.key === expandedWidgetKey
    && widget.lines.length > 0
  ));

  const expandedPresentation = expandedWidget ? presentations.get(expandedWidget.key) : undefined;
  const toggleWidget = (widget: ExtensionWidgetItem) => {
    setExpandedWidgetKey((current) => getNextExpandedWidgetKey(current, widget.key));
  };

  return (
    <>
      {expandedWidget && (
        <div className={`extension-widget-panels${expandedPresentation?.kind === "task-tree" ? " has-task-tree" : ""}`}>
          {(() => {
            const widget = expandedWidget;
            const index = widgets.indexOf(widget);
            const triggerId = `${idPrefix}-trigger-${index}`;
            const panelId = `${idPrefix}-panel-${index}`;
            return (
              <section
                key={widget.key}
                id={panelId}
                className={`extension-widget-panel${expandedPresentation?.kind === "task-tree" ? " is-task-tree" : ""}`}
                aria-labelledby={triggerId}
                tabIndex={widget.interactive ? 0 : undefined}
                onKeyDown={widget.interactive && onInput ? (event) => {
                  if (event.target !== event.currentTarget) return;
                  const data = toTerminalKeyData(event) ?? (event.key.length === 1 && !event.metaKey && !event.ctrlKey ? event.key : null);
                  if (!data) return;
                  event.preventDefault(); event.stopPropagation();
                  void sendInput(data);
                } : undefined}
              >
                {widget.interactive && onInput && (
                  <div className="extension-widget-input-controls" role="group" aria-label={widget.key}>
                    {([['ArrowDown', '↓'], ['ArrowUp', '↑'], ['ArrowLeft', '←'], ['ArrowRight', '→'], ['Enter', 'Enter'], ['Escape', 'Esc']] as const).map(([key, label]) => (
                      <button key={key} type="button" data-terminal-key={key} aria-label={key}
                        onClick={() => void sendInput(toTerminalKeyData({ key, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false })!)}>{label}</button>
                    ))}
                  </div>
                )}
                {inputError && <div role="alert">{inputError}</div>}
                {expandedPresentation?.kind === "task-tree" ? <TaskTreeWidget model={expandedPresentation.model} /> : (
                  <>
                    <div className="extension-widget-panel-heading">{widget.key}</div>
                    <pre className="extension-widget-content"><AnsiText text={formatExtensionWidgetContent(widget.lines)} /></pre>
                  </>
                )}
              </section>
            );
          })()}
        </div>
      )}
      <div className="extension-status-row">
        <div className="extension-widget-triggers" aria-label={t("chat.extensionWidgets")}>
          {widgets.map((widget, index) => {
            const presentation = presentations.get(widget.key);
            const structuredLabel = presentation?.kind === "task-tree" ? [presentation.model.title,
              ...taskTreeSummaryParts(presentation.model).map(({ state, count }) => `${count} ${t(`taskTree.state.${state}`)}`),
            ].join(" · ") : undefined;
            const expandable = widget.lines.length > 0;
            const expanded = expandable && widget.key === expandedWidget?.key;
            const updating = updatingWidgetKeys.has(widget.key);
            const lineCountLabel = t(
              widget.lines.length === 1 ? "chat.extensionWidgetLine" : "chat.extensionWidgetLines",
              { count: widget.lines.length },
            );
            const placementLabel = t(
              widget.placement === "belowEditor"
                ? "chat.extensionWidgetBelow"
                : "chat.extensionWidgetAbove",
            );
            const triggerId = `${idPrefix}-trigger-${index}`;
            const panelId = `${idPrefix}-panel-${index}`;
            const content = (
              <>
                <span className="extension-widget-update-pulse" aria-hidden="true" />
                <span className="extension-widget-placement" aria-hidden="true">
                  <svg
                    className="extension-widget-placement-icon"
                    viewBox="0 0 8 6"
                    width="8"
                    height="6"
                    data-direction={widget.placement === "belowEditor" ? "down" : "up"}
                    focusable="false"
                  >
                    <path
                      d={widget.placement === "belowEditor"
                        ? "M0 0h8L4 6z"
                        : "M4 0l4 6H0z"}
                    />
                  </svg>
                </span>
                <span className="extension-widget-key">{structuredLabel ?? widget.key}</span>
              </>
            );

            return expandable ? (
              <button
                key={widget.key}
                id={triggerId}
                type="button"
                className={`extension-widget-trigger${structuredLabel ? " is-structured" : ""}${expanded ? " is-expanded" : ""}${updating ? " is-updating" : ""}`}
                aria-controls={panelId}
                aria-expanded={expanded}
                aria-label={`${placementLabel}: ${structuredLabel ?? widget.key}, ${lineCountLabel}`}
                title={`${structuredLabel ?? widget.key} - ${placementLabel} - ${expanded ? t("i18n.collapse") : t("i18n.expand")}`}
                onClick={() => toggleWidget(widget)}
              >
                {content}
              </button>
            ) : (
              <div
                key={widget.key}
                className={`extension-widget-trigger${updating ? " is-updating" : ""}`}
                aria-label={`${placementLabel}: ${widget.key}, ${lineCountLabel}`}
                title={`${widget.key} - ${placementLabel}`}
              >
                {content}
              </div>
            );
          })}
        </div>
        {children}
      </div>
    </>
  );
}
