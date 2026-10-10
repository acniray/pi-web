import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const { Terminal } = createRequire(import.meta.url)("@xterm/xterm");

async function loadSubject() {
  return import("./custom-ui-terminal.ts");
}

test("headless custom UI exposes stable terminal dimensions", async () => {
  const { createHeadlessCustomUiTui, DEFAULT_CUSTOM_UI_COLUMNS, DEFAULT_CUSTOM_UI_ROWS } = await loadSubject();
  const tui = createHeadlessCustomUiTui(() => {});

  assert.deepEqual(tui.terminal, {
    columns: DEFAULT_CUSTOM_UI_COLUMNS,
    rows: DEFAULT_CUSTOM_UI_ROWS,
    kittyProtocolActive: false,
  });
  assert.equal(Object.isFrozen(tui), true);
  assert.equal(Object.isFrozen(tui.terminal), true);
});

test("resize updates the existing facade before requesting a forced render", async () => {
  const subject = await loadSubject();
  assert.equal(typeof subject.resizeHeadlessCustomUiTui, "function");
  const renders = [];
  const tui = subject.createHeadlessCustomUiTui((force) => {
    renders.push([tui.terminal.columns, tui.terminal.rows, force]);
  }, 80, 24);
  const terminal = tui.terminal;
  assert.equal(subject.resizeHeadlessCustomUiTui(tui, 120, 32), true);
  assert.equal(tui.terminal, terminal);
  assert.deepEqual(renders, [[120, 32, true]]);
  assert.equal(subject.resizeHeadlessCustomUiTui(tui, 120, 32), false);
  assert.equal(renders.length, 1);
  assert.deepEqual(Object.keys(tui).sort(), ["focusedComponent", "getFocusedComponent", "requestRender", "setFocus", "terminal"]);
});

test("invalid sizes never mutate terminal dimensions or trigger rendering", async () => {
  const subject = await loadSubject();
  assert.equal(typeof subject.resizeHeadlessCustomUiTui, "function");
  let renders = 0;
  const tui = subject.createHeadlessCustomUiTui(() => { renders += 1; }, 80, 24);
  for (const [cols, rows] of [[0, 24], [501, 24], [80.5, 24], [80, 0], [80, 201], [NaN, 24]]) {
    assert.throws(() => subject.resizeHeadlessCustomUiTui(tui, cols, rows), RangeError);
  }
  assert.equal(tui.terminal.columns, 80);
  assert.equal(tui.terminal.rows, 24);
  assert.equal(renders, 0);
});

test("custom frames preserve ANSI, borders, padding and empty rows without overflowing the viewport", async () => {
  const subject = await loadSubject();
  assert.equal(typeof subject.renderCustomUiFrame, "function");
  assert.equal(subject.renderCustomUiFrame(["", "\x1b[31m│ 中 │  ", "cursor\x1b_pi:c\x07", "overflow"], 3),
    "\x1b[0m\x1b[2J\x1b[H\x1b[?7l\x1b[0m\r\n\x1b[31m│ 中 │  \x1b[0m\r\ncursor\x1b7\x1b8\x1b[0m\x1b[?7h");
  assert.equal(subject.renderCustomUiFrame([], 24), "\x1b[0m\x1b[2J\x1b[H\x1b[?7l\x1b[0m\x1b[?7h");
});

test("custom frames restore the input cursor after drawing subsequent rows", async (t) => {
  const { renderCustomUiFrame } = await loadSubject();
  const terminal = new Terminal({ cols: 30, rows: 8, scrollback: 0, allowProposedApi: true });
  t.after(() => terminal.dispose());
  // Exercise the same xterm parser as the browser, not a hand-rolled width calculator.
  for (const [line, col, plain] of [
    ["ab\x1b_pi:c\x07cd", 2, "abcd"],
    ["\x1b[32m中e\u0301\x1b_pi:c\x07x", 3, "中e\u0301x"],
  ]) {
    await new Promise((resolve) => terminal.write(renderCustomUiFrame(["Header", line, "Footer"], 8), resolve));
    assert.equal(terminal.buffer.active.cursorY, 1);
    assert.equal(terminal.buffer.active.cursorX, col);
    assert.equal(terminal.buffer.active.getLine(1).translateToString(true), plain);
    assert.equal(terminal.buffer.active.getLine(2).translateToString(true), "Footer");
  }
  // A new frame without a visible marker must not reuse the old saved position.
  await new Promise((resolve) => terminal.write(renderCustomUiFrame(["Header", "hidden\x1b_pi:c\x07"], 1), resolve));
  assert.equal(terminal.buffer.active.cursorY, 0);
  assert.equal(terminal.buffer.active.cursorX, 6);
});

test("custom frames never restore a stale cursor from a clipped or absent marker", async () => {
  const { renderCustomUiFrame } = await loadSubject();
  for (const lines of [["Header", "hidden\x1b_pi:c\x07"], ["Header", "Footer"]]) {
    const frame = renderCustomUiFrame(lines, 1);
    assert.equal(frame.includes("\x1b7"), false);
    assert.equal(frame.includes("\x1b8"), false);
  }
});

test("headless focus updates built-in Input markers and clears the previous focus", async () => {
  const { createHeadlessCustomUiTui } = await loadSubject();
  const { Input, CURSOR_MARKER } = await import("@earendil-works/pi-tui");
  const first = new Input();
  const second = new Input();
  const tui = createHeadlessCustomUiTui(() => {}, 80, 24, first);
  assert.equal(first.focused, true);
  assert.ok(first.render(20).join("").includes(CURSOR_MARKER));
  tui.setFocus(second);
  assert.equal(first.focused, false);
  assert.equal(second.focused, true);
  assert.equal(first.render(20).join("").includes(CURSOR_MARKER), false);
  assert.equal(tui.getFocusedComponent(), second);
  tui.setFocus(null);
  assert.equal(second.focused, false);
  assert.equal(tui.getFocusedComponent(), null);
});

test("headless custom UI supports plugin rendering and render requests", async () => {
  const { createHeadlessCustomUiTui } = await loadSubject();
  let renders = 0;
  const tui = createHeadlessCustomUiTui(() => { renders += 1; }, 80, 24);
  const pluginComponent = {
    render: (width) => [`${width}:${tui.terminal.columns}x${tui.terminal.rows}`],
  };

  assert.deepEqual(pluginComponent.render(80), ["80:80x24"]);
  tui.requestRender();
  assert.equal(renders, 1);
});
