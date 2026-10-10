import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url);
const { listSessionChildren, identifyContainedSession, collectSessionReferences } = await jiti.import('./session-children.ts');

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'session-children-'));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = root;
  t.after(() => { if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous; rmSync(root, { recursive: true, force: true }); });
  const dir = join(root, 'sessions', 'project'); mkdirSync(dir, { recursive: true });
  function session(path, id, cwd = '/project', extra = []) {
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, [
      { type: 'session', version: 3, id, cwd, timestamp: '2026-01-01T00:00:00Z' },
      { type: 'message', id: 'u', parentId: null, timestamp: '2026-01-01T00:00:00Z', message: { role: 'user', content: 'Task: a long private prompt' } },
      ...extra,
    ].map(JSON.stringify).join('\n') + '\n');
  }
  const parent = join(dir, 'parent.jsonl');
  return { root, dir, parent, session };
}

test('contained sessions acquire their actual parent, regardless of plugin or execution cwd', async t => {
  const f = fixture(t); f.session(f.parent, 'parent');
  const child = join(f.dir, 'parent', 'launch', 'attempt', 'child.jsonl');
  f.session(child, 'child', '/installed/plugin');
  assert.deepEqual(identifyContainedSession(child), { id: 'parent', path: f.parent, cwd: '/project' });
  assert.equal(identifyContainedSession(f.parent), null);
  assert.equal((await listSessionChildren('parent', f.parent))[0].relation.status, 'unknown');
});

test('discovers only the selected parent children and uses explicitly referenced labels', async t => {
  const f = fixture(t);
  const child = join(f.dir, 'parent', 'launch', 'attempt', 'child.jsonl');
  f.session(f.parent, 'parent', '/project', [{ type: 'message', id: 'r', parentId: 'u', message: { role: 'toolResult', content: [], details: { results: [{ sessionFile: child, agent: 'scout', label: 'Check boundaries', status: 'completed' }] } } }]);
  f.session(child, 'child', '/installed/plugin');
  f.session(join(f.dir, 'unrelated.jsonl'), 'other');
  const children = await listSessionChildren('parent', f.parent);
  assert.equal(children.length, 1);
  assert.equal(children[0].displayName, 'Check boundaries');
  assert.equal(children[0].relation.parentSessionId, 'parent');
  assert.equal(children[0].relation.status, 'completed');
  assert.equal(children[0].cwd, '/installed/plugin', 'execution cwd must not be fabricated');
  assert.equal(children[0].projectRoot, '/project', 'workspace selection must follow the parent, not the execution package');
});

test('does not follow symlinks or accept references outside the session storage root', async t => {
  const f = fixture(t); f.session(f.parent, 'parent');
  const external = join(f.root, 'outside.jsonl'); f.session(external, 'outside');
  const dir = join(f.dir, 'parent'); mkdirSync(dir);
  symlinkSync(external, join(dir, 'linked.jsonl'));
  assert.deepEqual(await listSessionChildren('parent', f.parent), []);
  assert.equal(identifyContainedSession(join(dir, 'linked.jsonl')), null);
});

test('uses declared async status metadata to keep live labels consistent and refuses other parents', async t => {
  const f = fixture(t);
  const child = join(f.dir, 'parent', 'launch', 'attempt', 'child.jsonl');
  const asyncDir = join(f.root, 'async-run'); mkdirSync(asyncDir);
  f.session(f.parent, 'parent', '/project', [{ type: 'message', id: 'r', parentId: 'u', message: { role: 'toolResult', content: [], details: { asyncDir } } }]);
  f.session(child, 'child', '/installed/plugin');
  const file = join(asyncDir, 'status.json');
  writeFileSync(file, JSON.stringify({ sessionId: 'parent', steps: [{ sessionFile: child, agent: 'scout', label: 'Live lane label', status: 'running' }] }));
  assert.equal((await listSessionChildren('parent', f.parent))[0].displayName, 'Live lane label');
  writeFileSync(file, JSON.stringify({ sessionId: f.parent, steps: [{ sessionFile: child, agent: 'scout', label: 'Path-owned live label', status: 'running' }] }));
  assert.equal((await listSessionChildren('parent', f.parent))[0].displayName, 'Path-owned live label');
  writeFileSync(file, JSON.stringify({ sessionId: 'somebody-else', steps: [{ sessionFile: child, label: 'Wrong parent' }] }));
  assert.notEqual((await listSessionChildren('parent', f.parent))[0].displayName, 'Wrong parent');
});

test('current declared metadata wins over historical launch replies', async t => {
  const f = fixture(t);
  const child = join(f.dir, 'parent', 'launch', 'attempt', 'child.jsonl');
  const asyncDir = join(f.root, 'async-run'); mkdirSync(asyncDir);
  f.session(f.parent, 'parent', '/project', [
    { type: 'message', id: 'r', parentId: 'u', message: { role: 'toolResult', content: [], details: { asyncDir } } },
    { type: 'message', id: 'r2', parentId: 'r', message: { role: 'toolResult', content: [], details: { sessionFile: child, status: 'running' } } },
  ]);
  f.session(child, 'child', '/installed/plugin');
  writeFileSync(join(asyncDir, 'status.json'), JSON.stringify({ sessionId: 'parent', steps: [{ sessionFile: child, status: 'completed' }] }));
  assert.equal((await listSessionChildren('parent', f.parent))[0].relation.status, 'completed');
});

test('metadata references are keyed by session paths, never by matching agent names or task prompts', () => {
  const refs = collectSessionReferences({ results: [
    { sessionFile: '/x/a.jsonl', agent: 'scout', label: 'A' },
    { sessionPath: '/x/b.jsonl', agent: 'scout', label: 'B' },
    { agent: 'scout', task: 'Do not use this as a title' },
  ] });
  assert.equal(refs.size, 2);
  assert.equal(refs.get('/x/a.jsonl').label, 'A');
  assert.equal(refs.get('/x/b.jsonl').label, 'B');
});
