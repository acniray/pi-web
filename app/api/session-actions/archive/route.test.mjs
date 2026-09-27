import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");

test("archive route delegates mutations to the installed extension", () => {
  assert.match(source, /runTransientExtensionCommand\([\s\S]*?"archive",[\s\S]*?--ids/);
  assert.doesNotMatch(source, /renameSync|unlinkSync|copyFileSync/);
});

test("archive route blocks running family members and closes idle wrappers first", () => {
  assert.match(source, /familyIds\(rootId, sessions\)/);
  assert.match(source, /getRpcSession\(id\)\?\.isRunning\(\)/);
  assert.match(source, /Running sessions cannot be archived/);
  assert.match(source, /if \(wrapper\?\.isAlive\(\)\) await wrapper\.shutdown\(\)/);
});

test("archive route invalidates session caches after extension mutation", () => {
  assert.match(source, /invalidateSessionPathCache\(id\)/);
  assert.match(source, /invalidateSessionManagerCache\(path\)/);
  assert.match(source, /invalidateSessionListCache\(\)/);
  assert.match(source, /listAllSessions\(\{ force: true \}\)/);
});
