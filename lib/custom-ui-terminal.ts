export const DEFAULT_CUSTOM_UI_COLUMNS = 92;
export const DEFAULT_CUSTOM_UI_ROWS = 40;

export interface HeadlessCustomUiTerminal {
  readonly columns: number;
  readonly rows: number;
  readonly kittyProtocolActive: false;
}

export interface HeadlessCustomUiTui {
  readonly terminal: HeadlessCustomUiTerminal;
  requestRender(force?: boolean): void;
  readonly focusedComponent: unknown;
  getFocusedComponent(): unknown;
  setFocus(component: unknown): void;
}

// Host-only resize controls: do not add web-specific methods to the extension's TUI.
const resizers = new WeakMap<HeadlessCustomUiTui, (columns: number, rows: number) => boolean>();

function setComponentFocused(component: unknown, focused: boolean): void {
  if (component !== null && (typeof component === "object" || typeof component === "function") && "focused" in component) {
    (component as { focused: boolean }).focused = focused;
  }
}

export function createHeadlessCustomUiTui(
  requestRender: (force?: boolean) => void,
  columns = DEFAULT_CUSTOM_UI_COLUMNS,
  rows = DEFAULT_CUSTOM_UI_ROWS,
  initialFocus: unknown = null,
): HeadlessCustomUiTui {
  let focusedComponent: unknown = null;
  const setFocus = (component: unknown) => {
    setComponentFocused(focusedComponent, false);
    focusedComponent = component;
    setComponentFocused(component, true);
  };
  setFocus(initialFocus);
  const terminal = Object.freeze({
    get columns() { return columns; },
    get rows() { return rows; },
    kittyProtocolActive: false as const,
  });

  const tui = Object.freeze({ terminal, requestRender,
    get focusedComponent() { return focusedComponent; },
    getFocusedComponent() { return focusedComponent; },
    setFocus,
  });
  resizers.set(tui, (nextColumns, nextRows) => {
    if (columns === nextColumns && rows === nextRows) return false;
    columns = nextColumns;
    rows = nextRows;
    requestRender(true);
    return true;
  });
  return tui;
}

export function resizeHeadlessCustomUiTui(tui: HeadlessCustomUiTui, columns: unknown, rows: unknown): boolean {
  if (typeof columns !== "number" || !Number.isInteger(columns) || columns < 2 || columns > 500
    || typeof rows !== "number" || !Number.isInteger(rows) || rows < 1 || rows > 200) {
    throw new RangeError("Invalid custom UI terminal size");
  }
  return resizers.get(tui)?.(columns, rows) ?? false;
}

/** Custom render results are complete screens, not append-only terminal output. */
export function renderCustomUiFrame(lines: readonly string[], rows: number): string {
  let hasCursor = false;
  const content = lines.slice(0, rows).map((line) => line.replace(/\x1b_pi:c\x07/g, () => {
    hasCursor = true;
    // Let xterm calculate the cell position, including ANSI, wide glyphs and
    // combining characters. Restore it after painting for textarea/IME placement.
    return "\x1b7";
  }));
  // Clear stale cells, retain the extension's grid, and prevent an oversized row
  // from wrapping into the next row. Bracketed paste / input modes remain intact.
  return "\x1b[0m\x1b[2J\x1b[H\x1b[?7l" + content.join("\x1b[0m\r\n")
    + (hasCursor ? "\x1b8" : "") + "\x1b[0m\x1b[?7h";
}
