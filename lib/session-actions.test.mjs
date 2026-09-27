import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { hasSessionArchiveAction, archiveSessionsWithExtension } = await jiti.import("./session-actions.ts");

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("archive capability appears only when pi-session-archive is enabled", async () => {
  const previousFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => response({
      packages: [],
      standaloneExtensions: [{
        kind: "extension",
        name: "pi-session-archive",
        path: "/tmp/pi-session-archive/index.ts",
        relativePath: "pi-session-archive/index.ts",
        scope: "global",
        enabled: true,
      }],
      totals: { extensions: 1, skills: 0, prompts: 0, themes: 0 },
      diagnostics: [],
      projectResourcesLoaded: true,
    });
    assert.equal(await hasSessionArchiveAction("/tmp/project"), true);

    globalThis.fetch = async () => response({
      packages: [],
      standaloneExtensions: [{
        kind: "extension",
        name: "pi-session-archive",
        path: "/tmp/pi-session-archive/index.ts",
        relativePath: "pi-session-archive/index.ts",
        scope: "global",
        enabled: false,
      }],
      totals: { extensions: 0, skills: 0, prompts: 0, themes: 0 },
      diagnostics: [],
      projectResourcesLoaded: true,
    });
    assert.equal(await hasSessionArchiveAction("/tmp/project"), false);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("archive action sends root ids to the server bridge", async () => {
  const previousFetch = globalThis.fetch;
  let request;
  try {
    globalThis.fetch = async (url, init) => {
      request = { url, init };
      return response({
        ok: true,
        archivedSessionIds: ["a", "b"],
        failedSessionIds: [],
        notifications: [],
      });
    };

    const result = await archiveSessionsWithExtension("/tmp/project", ["a", "b"]);
    assert.equal(request.url, "/api/session-actions/archive");
    assert.equal(request.init.method, "POST");
    assert.deepEqual(JSON.parse(request.init.body), {
      cwd: "/tmp/project",
      sessionIds: ["a", "b"],
    });
    assert.deepEqual(result.archivedSessionIds, ["a", "b"]);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
