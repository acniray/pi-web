import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const {
  listNicobailonChildSessions,
  nicobailonChildSessionRoot,
} = await createJiti(import.meta.url).import("./nicobailon-subagents.ts");

function sessionJson({ id, cwd, parentSession, name, prompt, timestamp }) {
  const header = {
    type: "session",
    version: 1,
    id,
    timestamp,
    cwd,
    ...(parentSession ? { parentSession } : {}),
  };
  const entries = [
    { type: "session_info", id: `info-${id}`, parentId: null, timestamp, name },
    {
      type: "message",
      id: `user-${id}`,
      parentId: null,
      timestamp,
      message: { role: "user", content: prompt, timestamp: Date.parse(timestamp) },
    },
  ];
  return [header, ...entries].map((entry) => JSON.stringify(entry)).join("\n") + "\n";
}

test("discovers nicobailon children under the parent without flattening unrelated files", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-nicobailon-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const projectSessions = join(root, "sessions", "project");
  await mkdir(projectSessions, { recursive: true });
  const parent = join(projectSessions, "2026-10-06_parent.jsonl");
  await writeFile(parent, sessionJson({
    id: "parent", cwd: root, name: "Main", prompt: "Main task",
    timestamp: "2026-10-06T00:00:00.000Z",
  }));

  const childRoot = nicobailonChildSessionRoot(parent);
  assert.equal(basename(childRoot), "2026-10-06_parent");
  await mkdir(join(childRoot, "run-a", "run-0"), { recursive: true });
  await mkdir(join(childRoot, "run-b", "run-1"), { recursive: true });
  await writeFile(join(childRoot, "run-a", "run-0", "session.jsonl"), sessionJson({
    id: "child-a", cwd: root, parentSession: parent,
    name: "reviewer: Review the parser", prompt: "Review the parser",
    timestamp: "2026-10-06T00:01:00.000Z",
  }));
  await writeFile(join(childRoot, "run-b", "run-1", "session.jsonl"), sessionJson({
    id: "child-b", cwd: root,
    name: "scout: Find the entry point", prompt: "Find the entry point",
    timestamp: "2026-10-06T00:02:00.000Z",
  }));

  await mkdir(join(childRoot, "forks", "run-0"), { recursive: true });
  await writeFile(join(childRoot, "forks", "run-0", "session.jsonl"), sessionJson({
    id: "ignored", cwd: root, parentSession: parent,
    name: "fork", prompt: "fork", timestamp: "2026-10-06T00:03:00.000Z",
  }));

  const children = await listNicobailonChildSessions("parent", parent);
  assert.deepEqual(children.map((child) => child.id), ["child-b", "child-a"]);
  assert.deepEqual(children.map((child) => child.relation), [
    { kind: "subagent", parentSessionId: "parent", profile: "scout", description: "Find the entry point", status: "completed" },
    { kind: "subagent", parentSessionId: "parent", profile: "reviewer", description: "Review the parser", status: "completed" },
  ]);
});
