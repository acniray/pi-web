// Run against a dev server with stored nested child sessions:
// PI_WEB_URL=http://127.0.0.1:30142 node e2e/session-list-smoke.mjs
// Unlike jiti unit tests, this exercises Turbopack's compiled session traversal.
import assert from 'node:assert/strict';

const base = process.env.PI_WEB_URL ?? 'http://127.0.0.1:30141';
for (const query of ['', '?summary=1']) {
  const response = await fetch(`${base}/api/sessions${query}`, {
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.ok(Array.isArray(body.sessions));
  assert.ok(body.sessions.some(session => session.relation?.kind === 'subagent'),
    'Use a session store containing nested child sessions to exercise ancestor traversal');
  console.log(`PASS /api/sessions${query}`);
}
