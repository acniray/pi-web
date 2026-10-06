import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const testAgentDir = await mkdtemp(join(tmpdir(), "pi-web-subagent-settings-route-"));
process.env.PI_CODING_AGENT_DIR = testAgentDir;

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { GET, PUT } = await jiti.import("./route.ts");

after(async () => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  await rm(testAgentDir, { recursive: true, force: true });
});

function request(body, contentType = "application/json") {
  return new Request("http://localhost/api/subagents/settings", {
    method: "PUT",
    headers: { "Content-Type": contentType, Host: "localhost" },
    body: JSON.stringify(body),
  });
}

test("settings route defaults to no backend and keeps legacy enabled mutations compatible", async () => {
  let response = await GET();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { enabled: false, maxConcurrent: 10, backend: "none" });

  response = await PUT(request({ enabled: true }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { enabled: true, maxConcurrent: 10, backend: "builtin" });
  assert.deepEqual(
    JSON.parse(await readFile(join(testAgentDir, "agents", "settings.json"), "utf8")),
    { version: 1, backend: "builtin", builtInEnabled: true },
  );

  response = await PUT(request({ enabled: false }));
  assert.deepEqual(await response.json(), { enabled: false, maxConcurrent: 10, backend: "none" });
});

test("settings route validates mutations", async () => {
  let response = await PUT(request({ enabled: "yes" }));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "enabled must be a boolean" });

  response = await PUT(request({ enabled: true }, "text/plain"));
  assert.equal(response.status, 415);
  assert.deepEqual(await response.json(), { error: "Content-Type must be application/json" });

  response = await PUT(request({ backend: "other" }));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "backend must be none, builtin or nicobailon" });

  response = await PUT(request({ backend: "nicobailon" }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { enabled: true, maxConcurrent: 20, backend: "nicobailon" });
  response = await PUT(request({ backend: "none" }));
  assert.deepEqual(await response.json(), { enabled: false, maxConcurrent: 10, backend: "none" });
  response = await PUT(request({ backend: "builtin" }));
  assert.equal((await response.json()).backend, "builtin");
});

test("settings route validates and persists backend-specific concurrency", async () => {
  await PUT(request({ backend: "builtin" }));
  let response = await PUT(request({ maxConcurrent: 2 }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { enabled: true, maxConcurrent: 2, backend: "builtin" });
  response = await PUT(request({ maxConcurrent: 0 }));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /positive safe integer/);

  response = await PUT(request({ maxConcurrent: 33 }));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /between 1 and 32/);

  response = await PUT(request({ backend: "nicobailon" }));
  assert.deepEqual(await response.json(), { enabled: true, maxConcurrent: 20, backend: "nicobailon" });
  response = await PUT(request({ maxConcurrent: 37 }));
  assert.deepEqual(await response.json(), { enabled: true, maxConcurrent: 37, backend: "nicobailon" });
  assert.equal(
    JSON.parse(await readFile(join(testAgentDir, "extensions", "subagent", "config.json"), "utf8")).globalConcurrencyLimit,
    37,
  );

  await PUT(request({ backend: "none" }));
  response = await PUT(request({ maxConcurrent: 2 }));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /requires an enabled subagent backend/);
});
