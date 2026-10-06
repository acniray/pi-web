import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const {
  DEFAULT_NICOBAILON_GLOBAL_CONCURRENCY_LIMIT,
  PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT,
  ensureNicobailonHostEnvironment,
  resolvePiCodingAgentPackageRoot,
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

test("host bridge uses Pi's own SDK package locator and preserves an explicit override", () => {
  const packageRoot = resolvePiCodingAgentPackageRoot();
  assert.ok(packageRoot, "expected Pi Web's installed pi-coding-agent package root");
  assert.equal(
    JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")).name,
    "@earendil-works/pi-coding-agent",
  );

  const env = {};
  assert.equal(ensureNicobailonHostEnvironment(env, () => packageRoot), packageRoot);
  assert.equal(env[PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT], packageRoot);

  env[PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT] = "/explicit/sdk";
  assert.equal(ensureNicobailonHostEnvironment(env, () => "/other/sdk"), "/explicit/sdk");
  assert.equal(env[PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT], "/explicit/sdk");
});
