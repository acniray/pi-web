"use client";

import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { subscribeFontPreferences } from "@/hooks/useFontPreferences";
import { readFontWeight } from "@/lib/font-preferences";
import { renderCustomUiFrame } from "@/lib/custom-ui-terminal";
import { toTerminalKeyData } from "@/lib/terminal-input";

interface Props {
  lines: string[];
  label: string;
  onInput: (data: string) => void;
  onResize: (cols: number, rows: number) => void | Promise<void>;
}

/** A terminal screen for any ctx.ui.custom component; no shell or plugin adapter. */
export function CustomUiTerminal({ lines, label, onInput, onResize }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const callbacksRef = useRef({ lines, onInput, onResize });
  callbacksRef.current = { lines, onInput, onResize };
  const paintRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    let scheduled = 0;
    let writing = false;
    let dirty = false;
    let resizing = false;
    let pendingSize: { cols: number; rows: number } | null = null;
    const style = getComputedStyle(container);
    const terminal = new Terminal({
      fontFamily: style.getPropertyValue("--font-mono").trim() || "monospace",
      fontWeight: readFontWeight(style.getPropertyValue("--font-mono-weight")),
      fontSize: 13,
      lineHeight: 1.25,
      scrollback: 0,
      screenReaderMode: true,
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(container);
    // Custom components consume terminal key bytes, including bracketed pastes.
    terminal.write("\x1b[?25l\x1b[?2004h");
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") return true;
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === "v") return false;
      if ((event.ctrlKey || event.metaKey) && key === "c" && terminal.hasSelection()) return false;
      if (event.isComposing) return true;
      // Retain the existing Pi key encodings, especially Shift-Enter and Alt arrows.
      // Normal text, IME composition and paste remain owned by xterm.js.
      const data = toTerminalKeyData(event);
      if (!data) return true;
      event.preventDefault();
      callbacksRef.current.onInput(data);
      return false;
    });
    const input = terminal.onData((data) => callbacksRef.current.onInput(data));

    const paint = () => {
      scheduled = 0;
      if (disposed) return;
      dirty = false;
      writing = true;
      terminal.write(renderCustomUiFrame(callbacksRef.current.lines, terminal.rows), () => {
        writing = false;
        if (!disposed && dirty) schedulePaint();
      });
    };
    const schedulePaint = () => {
      dirty = true;
      if (!disposed && !scheduled && !writing) scheduled = requestAnimationFrame(paint);
    };
    paintRef.current = schedulePaint;

    // Serialize and coalesce resize messages so an older viewport cannot arrive
    // after a newer one while the user drags a panel or rotates the device.
    const sendSize = async () => {
      if (resizing) return;
      resizing = true;
      try {
        while (pendingSize && !disposed) {
          const size = pendingSize;
          pendingSize = null;
          await callbacksRef.current.onResize(size.cols, size.rows);
        }
      } finally {
        resizing = false;
      }
    };
    const reportSize = () => {
      container.dataset.columns = String(terminal.cols);
      container.dataset.rows = String(terminal.rows);
      pendingSize = { cols: terminal.cols, rows: terminal.rows };
      void sendSize();
      schedulePaint();
    };
    const resize = terminal.onResize(reportSize);
    const fitToContainer = () => {
      if (disposed || !container.offsetWidth || !container.offsetHeight) return;
      fit.fit();
      if (terminal.cols > 500 || terminal.rows > 200) {
        terminal.resize(Math.min(terminal.cols, 500), Math.min(terminal.rows, 200));
      }
    };
    const updateAppearance = () => {
      if (disposed) return;
      const style = getComputedStyle(container);
      terminal.options.fontFamily = style.getPropertyValue("--font-mono").trim() || "monospace";
      terminal.options.fontWeight = readFontWeight(style.getPropertyValue("--font-mono-weight"));
      terminal.options.theme = {
        background: style.getPropertyValue("--bg-panel").trim(),
        foreground: style.getPropertyValue("--text").trim(),
        cursor: style.getPropertyValue("--accent").trim(),
        selectionBackground: style.getPropertyValue("--bg-selected").trim(),
      };
      fitToContainer();
      schedulePaint();
    };
    const observer = new ResizeObserver(fitToContainer);
    observer.observe(container);
    const themeObserver = new MutationObserver(updateAppearance);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class", "style"] });
    const unsubscribeFonts = subscribeFontPreferences(updateAppearance);
    updateAppearance();
    reportSize();
    terminal.focus();

    return () => {
      disposed = true;
      paintRef.current = null;
      cancelAnimationFrame(scheduled);
      observer.disconnect();
      themeObserver.disconnect();
      unsubscribeFonts();
      input.dispose();
      resize.dispose();
      terminal.dispose();
    };
  }, []);

  useEffect(() => { paintRef.current?.(); }, [lines]);

  return (
    <div className="terminal-xterm extension-custom-terminal" onKeyDown={(event) => event.stopPropagation()}>
      <div ref={containerRef} className="terminal-xterm-host" aria-label={label} />
    </div>
  );
}
