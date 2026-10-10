import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, tsconfigPaths: true });
const {
  countTaskTreeLeafStates,
  findTaskTreeNode,
  firstTaskTreeNode,
} = await jiti.import("./extension-widget-model.ts");

const tree = [{
  key: "root/0:workflow",
  id: "workflow",
  label: "workflow",
  state: "running",
  children: [
    {
      key: "root/0:workflow/0:shared",
      id: "shared",
      label: "first",
      state: "complete",
    },
    {
      key: "root/0:workflow/1:active",
      id: "active",
      label: "active",
      state: "running",
    },
  ],
}, {
  key: "root/1:other",
  id: "other",
  label: "other",
  state: "queued",
  children: [{
    key: "root/1:other/0:shared",
    id: "shared",
    label: "second",
    state: "queued",
  }],
}];

test("summarizes leaf work without double-counting active parents", () => {
  const counts = countTaskTreeLeafStates(tree);
  assert.equal(counts.running, 1);
  assert.equal(counts.queued, 1);
  assert.equal(counts.complete, 1);
});

test("selects an active leaf by default", () => {
  assert.equal(firstTaskTreeNode(tree)?.key, "root/0:workflow/1:active");
});

test("uses adapter-provided tree keys so repeated source ids remain selectable", () => {
  assert.equal(findTaskTreeNode(tree, "root/0:workflow/0:shared")?.label, "first");
  assert.equal(findTaskTreeNode(tree, "root/1:other/0:shared")?.label, "second");
});
