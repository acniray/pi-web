import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./instrumentation-node.ts", import.meta.url), "utf8");

test("seeds nicobailon host SDK root at Node process startup", () => {
  const seed = source.indexOf("ensureNicobailonHostEnvironment()");
  const dispatcher = source.indexOf("configureHttpDispatcher()");
  assert.ok(seed >= 0);
  assert.ok(dispatcher >= 0);
  assert.ok(seed < dispatcher);
});
