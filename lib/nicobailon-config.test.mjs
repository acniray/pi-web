import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const {
  DEFAULT_NICOBAILON_GLOBAL_CONCURRENCY_LIMIT,
  PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT,
  ensureNicobailonHostEnvironment,
  findPackageRootFromEntry,
  readNicobailonGlobalConcurrencyLimit,
  writeNicobailonGlobalConcurrencyLimit,
} = await createJiti(import.meta.url).import("./nicobailon-config.ts");

test("nicobailon concurrency defaults to 20 and preserves unrelated config", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-nico-config-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const configPath = join(root, "extensions", "subagent", "config.json");

  assert.equal(readNicobailonGlobalConcurrencyLimit(configPath), DEFAULT_NICOBAILON_GLOBAL_CONCURRENCY_LIMIT);
  writeNicobailonGlobalConcurrencyLimit(37, configPath);
  await writeFile(configPath, JSON.stringify({
    ...JSON.parse(await readFile(configPath, "utf8")),
    asyncByDefault: false,
  }));
  writeNicobailonGlobalConcurrencyLimit(21, configPath);

  assert.deepEqual(JSON.parse(await readFile(configPath, "utf8")), {
    globalConcurrencyLimit: 21,
    asyncByDefault: false,
  });
  assert.throws(() => writeNicobailonGlobalConcurrencyLimit(0, configPath), /positive safe integer/);
});

test("host bridge finds the Pi SDK package root and does not overwrite an explicit override", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-nico-host-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const packageRoot = join(root, "node_modules", "@earendil-works", "pi-coding-agent");
  const entry = join(packageRoot, "dist", "index.js");
  await mkdir(join(packageRoot, "dist"), { recursive: true });
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent" }));
  await writeFile(entry, "export {};");

  assert.equal(findPackageRootFromEntry(entry), packageRoot);

  const env = {};
  assert.equal(ensureNicobailonHostEnvironment(env, () => packageRoot), packageRoot);
  assert.equal(env[PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT], packageRoot);

  env[PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT] = "/explicit/sdk";
  assert.equal(ensureNicobailonHostEnvironment(env, () => "/other/sdk"), "/explicit/sdk");
  assert.equal(env[PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT], "/explicit/sdk");
});
