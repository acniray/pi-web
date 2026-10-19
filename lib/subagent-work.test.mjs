import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { getWorkingSubagentSessionIds, SUBAGENT_WORK_CACHE_MS } = await jiti.import("./subagent-work.ts");
const { registerSessionLivenessProvider } = await jiti.import("./session-liveness.ts");

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "subagent-work-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = root;
  t.after(() => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  });
  const dir = join(root, "sessions", "project");
  mkdirSync(dir, { recursive: true });
  const parent = join(dir, "parent.jsonl");
  const child = join(dir, "parent", "launch", "attempt", "child.jsonl");
  mkdirSync(join(child, ".."), { recursive: true });
  const asyncDir = join(root, "async-run");
  mkdirSync(asyncDir);
  const write = (path, entries) => writeFileSync(
    path,
    entries.map(JSON.stringify).join("\n") + "\n",
  );
  write(parent, [
    { type: "session", version: 3, id: "parent", cwd: "/project", timestamp: "2026-01-01T00:00:00Z" },
    { type: "message", id: "u", parentId: null, timestamp: "2026-01-01T00:00:00Z", message: { role: "user", content: "Task" } },
    { type: "message", id: "r", parentId: "u", timestamp: "2026-01-01T00:00:01Z", message: { role: "toolResult", content: [], details: { asyncDir } } },
  ]);
  write(child, [
    { type: "session", version: 3, id: "child", cwd: "/project", timestamp: "2026-01-01T00:00:00Z", parentSession: parent },
  ]);
  const statusFile = join(asyncDir, "status.json");
  const declare = (status) => writeFileSync(statusFile, JSON.stringify({
    sessionId: "parent",
    steps: [{ sessionFile: child, agent: "scout", status }],
  }));
  return { parent, statusFile, declare };
}

test("a finished child stops counting even while the extension still holds its liveness provider", async (t) => {
  const f = fixture(t);
  let now = 1_000_000;
  t.mock.method(Date, "now", () => now);
  // The provider stays active after the work ends (an owed result, a pending
  // wake); it must only nominate the session, never decide.
  t.after(registerSessionLivenessProvider({
    name: "pi-subagents",
    sessionId: "parent",
    sessionFile: f.parent,
    isActive: () => true,
  }));

  f.declare("running");
  assert.deepEqual(await getWorkingSubagentSessionIds(new Set()), ["parent"]);

  // A live wrapper run already owns the row; the second set does not need it.
  assert.deepEqual(await getWorkingSubagentSessionIds(new Set(["parent"])), []);

  // The children are re-read once the short verification cache expires.
  f.declare("completed");
  now += SUBAGENT_WORK_CACHE_MS - 1;
  assert.deepEqual(await getWorkingSubagentSessionIds(new Set()), ["parent"]);
  now += 2;
  assert.deepEqual(await getWorkingSubagentSessionIds(new Set()), []);
});

test("a candidate without a session file is never claimed", async (t) => {
  t.after(registerSessionLivenessProvider({
    name: "pi-subagents",
    sessionId: "session-without-file",
    isActive: () => true,
  }));
  assert.deepEqual(await getWorkingSubagentSessionIds(new Set()), []);
});
