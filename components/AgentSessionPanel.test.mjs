import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./AgentSessionPanel.tsx", import.meta.url), "utf8");

test("keeps the main session first and makes every agent session selectable", () => {
  const mainRow = source.indexOf("session={rootSession}");
  const subagentRows = source.indexOf("visibleSubagents.map");
  assert.ok(mainRow > 0);
  assert.ok(subagentRows > mainRow);
  assert.match(source, /onSelect=\{\(\) => onSelectSession\(rootSession\)\}/);
  assert.match(source, /onSelect=\{\(\) => onSelectSession\(session\)\}/);
  assert.match(source, /aria-selected=\{selected\}/);
});

test("sorts running subagents first and enables search only for larger families", () => {
  assert.match(source, /if \(aRunning !== bRunning\) return aRunning \? -1 : 1/);
  assert.match(source, /subagents\.length > 8/);
  assert.match(source, /relation\?\.description, relation\?\.profile, session\.name, session\.firstMessage/);
  assert.match(source, /maxHeight: "min\(58dvh, 480px\)"/);
});

test("renders as a compact left-positioned dropdown without a centered inner width", () => {
  assert.match(source, /borderLeft: "1px solid var\(--border\)"/);
  assert.match(source, /borderRadius: "0 0 6px 6px"/);
  assert.doesNotMatch(source, /maxWidth: 680/);
});

test("shows persisted completion states while live running state takes precedence", () => {
  assert.match(source, /const status: SubagentSessionStatus = running \? "running" : relation\?\.status \?\? "completed"/);
  assert.match(source, /t\(`agentSwitcher\.status\.\$\{status\}`\)/);
  assert.match(source, /status === "failed"/);
  assert.match(source, /status === "aborted" \|\| status === "interrupted"/);
});

test("renders nicobailon workflow snapshots inside the existing Agents panel", () => {
  assert.match(source, /workflowSnapshot\?: NicobailonAsyncSnapshot/);
  assert.match(source, /workflowRuns\.map\(\(run\) =>/);
  assert.match(source, /<WorkflowRunCard key=\{run\.id\}/);
  assert.match(source, /node\.activity\?\.currentTool/);
  assert.match(source, /agentSwitcher\.workflowStatus\.\$\{node\.state\}/);
});


test("shows live subagents from the async snapshot before a session file exists", () => {
  assert.match(source, /function collectLiveSubagentNodes/);
  assert.match(source, /node\.kind === "step" \|\| \(node\.kind === "subagent" && !hasStepChildren\)/);
  assert.match(source, /<LiveAgentRow/);
  assert.match(source, /agentSwitcher\.liveRuntime/);
  assert.match(source, /visibleSubagents\.length === 0 && visibleLiveSubagentNodes\.length === 0/);
});
