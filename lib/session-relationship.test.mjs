import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url);
const { findStoredSessionFile, identifyContainedSession, resolveSessionOwnership, isRegularStoredSessionFile } = await jiti.import('./session-relationship.ts');
const { resolveSessionPath, resolveSessionIdByPath, invalidateSessionPathCache } = await jiti.import('./session-reader.ts');

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'session-relationship-'));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = root;
  t.after(() => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  });
  const dir = join(root, 'sessions', 'project');
  mkdirSync(dir, { recursive: true });
  const parent = join(dir, '2026-01-01T00-00-00-000Z_parent.jsonl');
  function session(path, id, extra = {}) {
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, JSON.stringify({ type: 'session', version: 3, id, cwd: '/project',
      timestamp: '2026-01-01T00:00:00Z', ...extra }) + '\n');
  }
  return { root, dir, parent, session };
}

test('a nested container child is found by id after a cold start', async t => {
  const f = fixture(t);
  f.session(f.parent, 'parent');
  // The real layout: a child lives under a container named after its parent and
  // its own file is `session.jsonl`, so no `_<id>.jsonl` suffix can match it.
  const child = join(f.dir, '2026-01-01T00-00-00-000Z_parent', 'child-uuid', 'run-0', 'session.jsonl');
  f.session(child, 'child-id', { parentSession: f.parent });
  invalidateSessionPathCache('child-id');
  assert.equal(await findStoredSessionFile('child-id'), child);
  assert.equal(await resolveSessionPath('child-id'), child, 'a cold start must open a nested child by id');
  assert.equal(await resolveSessionIdByPath(child), 'child-id');
  assert.deepEqual(identifyContainedSession(child), { id: 'parent', path: f.parent, cwd: '/project' });
});

test('a top-level session is still found by its canonical file name', async t => {
  const f = fixture(t);
  f.session(f.parent, 'parent');
  assert.equal(await findStoredSessionFile('parent'), f.parent);
});

test('an unknown or unusable id resolves to null rather than a guess', async t => {
  const f = fixture(t);
  f.session(f.parent, 'parent');
  assert.equal(await findStoredSessionFile('nobody'), null);
  assert.equal(await findStoredSessionFile(''), null);
  assert.equal(await findStoredSessionFile('..'), null);
  assert.equal(await findStoredSessionFile('a/b'), null);
  assert.equal(await findStoredSessionFile('a\\b'), null);
  assert.equal(await resolveSessionPath('nobody'), null);
});

test('the bounded walk refuses symlinked files and directories', async t => {
  const f = fixture(t);
  f.session(f.parent, 'parent');
  const outside = join(f.root, 'outside.jsonl');
  f.session(outside, 'outside');
  const container = join(f.dir, '2026-01-01T00-00-00-000Z_parent'); mkdirSync(container, { recursive: true });
  symlinkSync(outside, join(container, 'linked.jsonl'));
  const escaping = join(f.root, 'elsewhere');
  mkdirSync(escaping, { recursive: true });
  f.session(join(escaping, 'session.jsonl'), 'escaped');
  symlinkSync(escaping, join(container, 'escape-dir'));
  assert.equal(await findStoredSessionFile('outside'), null, 'the walk stays inside the sessions root');
  assert.equal(await findStoredSessionFile('escaped'), null, 'a symlinked directory is not entered');
  assert.equal(isRegularStoredSessionFile(join(container, 'linked.jsonl')), false);
  assert.equal(identifyContainedSession(join(container, 'linked.jsonl')), null);
});

test('a parentSession that no containing session declares stays a Fork', async t => {
  const f = fixture(t);
  f.session(f.parent, 'parent');
  // Its own file name is canonical for a different id and its declared parent
  // does not own the directory, so ownership is unprovable.
  const stray = join(f.dir, '2026-01-01T00-00-00-000Z_other', 'session.jsonl');
  f.session(stray, 'stray', { parentSession: f.parent });
  const row = { path: stray, id: 'stray', cwd: '/project', created: '', modified: '', messageCount: 0, firstMessage: '' };
  assert.equal(identifyContainedSession(stray), null);
  assert.equal(resolveSessionOwnership(row).owner, null);
  assert.equal(resolveSessionOwnership(row).relation, undefined);
});
