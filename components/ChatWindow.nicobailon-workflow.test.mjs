import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");

test("hands nicobailon async snapshots to the existing Agents panel and hides raw host widgets", () => {
  assert.match(source, /findNicobailonAsyncSnapshot\(extensionWidgets\)/);
  assert.match(source, /onSubagentWorkflowChange\?\.\(subagentWorkflowSnapshot\)/);
  assert.match(source, /isNicobailonHostStatusWidget\(widget\.key\)/);
  assert.match(source, /<ExtensionStatusBar statuses=\{extensionStatuses\} widgets=\{visibleExtensionWidgets\}/);
});
