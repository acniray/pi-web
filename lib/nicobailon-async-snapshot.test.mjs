import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const {
  findNicobailonAsyncSnapshot,
  isNicobailonHostStatusWidget,
  parseNicobailonAsyncSnapshot,
} = await jiti.import("./nicobailon-async-snapshot.ts");

test("parses the RPC-host async widget snapshot", () => {
  const snapshot = parseNicobailonAsyncSnapshot([
    'PI_SUBAGENT_ASYNC_JSON:{"kind":"pi-subagents.async-status-snapshot","version":1,"generatedAt":1234,"runs":[{"id":"run-1","kind":"workflow","label":"benchmark","state":"running","children":[{"id":"step-0","kind":"step","label":"research","state":"complete"},{"id":"step-1","kind":"step","label":"implement","state":"running","activity":{"currentTool":"bash"}}]}]}',
  ]);

  assert.equal(snapshot?.kind, "pi-subagents.async-status-snapshot");
  assert.equal(snapshot?.runs[0]?.kind, "workflow");
  assert.equal(snapshot?.runs[0]?.children?.[1]?.activity?.currentTool, "bash");
});

test("fails closed for malformed or incompatible payloads", () => {
  assert.equal(parseNicobailonAsyncSnapshot(["PI_SUBAGENT_ASYNC_JSON:{oops"]), null);
  assert.equal(parseNicobailonAsyncSnapshot([
    'PI_SUBAGENT_ASYNC_JSON:{"kind":"pi-subagents.async-status-snapshot","version":2,"generatedAt":1,"runs":[]}',
  ]), null);
});

test("finds the async widget and identifies host-only nicobailon widgets", () => {
  const snapshot = findNicobailonAsyncSnapshot([
    { key: "other", lines: ["plain"] },
    {
      key: "subagent-async",
      lines: ['PI_SUBAGENT_ASYNC_JSON:{"kind":"pi-subagents.async-status-snapshot","version":1,"generatedAt":5,"runs":[]}'],
    },
  ]);
  assert.equal(snapshot?.generatedAt, 5);
  assert.equal(isNicobailonHostStatusWidget("subagent-async"), true);
  assert.equal(isNicobailonHostStatusWidget("subagent-fleet-status"), true);
  assert.equal(isNicobailonHostStatusWidget("other"), false);
});
