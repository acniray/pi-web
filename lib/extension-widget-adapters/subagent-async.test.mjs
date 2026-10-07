import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  tsconfigPaths: true,
});
const { decodeSubagentAsyncWidget } = await jiti.import("./subagent-async.ts");

function widget(lines) {
  return { key: "subagent-async", lines, placement: "aboveEditor" };
}

test("decodes the documented async snapshot into a generic task tree", () => {
  const model = decodeSubagentAsyncWidget(widget([
    'PI_SUBAGENT_ASYNC_JSON:{"kind":"pi-subagents.async-status-snapshot","version":1,"generatedAt":1000,"runs":[{"id":"workflow-1","kind":"workflow","label":"review","state":"running","startedAt":100,"activity":{"toolCount":3},"children":[{"id":"route-callers","kind":"step","label":"route-callers","state":"running","activity":{"currentTool":"bash","turnCount":2}}]}],"omitted":{"runs":1,"children":2,"byteLimitExceeded":false}}',
  ]));

  assert.equal(model?.kind, "task-tree");
  assert.equal(model?.title, "Async agents");
  assert.equal(model?.generatedAt, 1000);
  assert.equal(model?.nodes[0]?.type, "workflow");
  assert.equal(model?.nodes[0]?.children?.[0]?.label, "route-callers");
  assert.equal(model?.nodes[0]?.children?.[0]?.activity?.currentTool, "bash");
  assert.deepEqual(model?.omitted, { nodes: 1, children: 2, byteLimitExceeded: false });
});

test("ignores unrelated widgets and incompatible snapshots", () => {
  assert.equal(decodeSubagentAsyncWidget(widget(["plain text"])), null);
  assert.equal(decodeSubagentAsyncWidget(widget([
    'PI_SUBAGENT_ASYNC_JSON:{"kind":"pi-subagents.async-status-snapshot","version":2,"generatedAt":1,"runs":[]}',
  ])), null);
  assert.equal(decodeSubagentAsyncWidget(widget(["PI_SUBAGENT_ASYNC_JSON:{oops"])), null);
});

test("drops malformed nodes without failing the whole snapshot", () => {
  const model = decodeSubagentAsyncWidget(widget([
    'PI_SUBAGENT_ASYNC_JSON:{"kind":"pi-subagents.async-status-snapshot","version":1,"generatedAt":1,"runs":[{"id":"good","kind":"subagent","label":"scout","state":"running"},{"id":"bad","label":"missing state"}]}',
  ]));
  assert.deepEqual(model?.nodes.map((node) => node.id), ["good"]);
});
