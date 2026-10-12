import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url);
const { listSessionChildren, identifyContainedSession, collectSessionReferences } = await jiti.import('./session-children.ts');
const { readSessionInfo } = await jiti.import('./session-reader.ts');
const { resolveSessionOwnership } = await jiti.import('./session-relationship.ts');

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'session-children-'));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = root;
  t.after(() => { if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous; rmSync(root, { recursive: true, force: true }); });
  const dir = join(root, 'sessions', 'project'); mkdirSync(dir, { recursive: true });
  function session(path, id, cwd = '/project', extra = []) {
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, [
      { type: 'session', version: 3, id, cwd, timestamp: '2026-01-01T00:00:00Z',
        ...(path.startsWith(join(dir, 'parent') + '/') ? { parentSession: parent } : {}) },
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

test('children with parentSession headers are still found inside a session-owned container', async t => {
  // Extension-owned children carry `parentSession` in their header, so the
  // native relation pass reads them as forks. Container ownership and explicit
  // references are the acceptance evidence here; the fork row is a top-level
  // user session outside any container, never a contained child.
  const f = fixture(t);
  const child = join(f.dir, 'parent', 'launch', 'attempt', 'child.jsonl');
  f.session(f.parent, 'parent');
  f.session(child, 'child', '/installed/plugin');
  writeFileSync(child, JSON.stringify({ type: 'session', version: 3, id: 'child', cwd: '/installed/plugin', timestamp: '2026-01-01T00:00:00Z', parentSession: f.parent }) + '\n');
  const children = await listSessionChildren('parent', f.parent);
  assert.equal(children.length, 1, 'a contained child must not be dropped by the fork-row rule');
  assert.equal(children[0].id, 'child');
  assert.equal(children[0].relation.status, 'unknown');
});

test('fork sessions outside a container stay out of the children list', async t => {
  const f = fixture(t);
  // Referenced from tool-result details, but a top-level storage-root file.
  const fork = join(f.dir, 'fork.jsonl');
  f.session(f.parent, 'parent', '/project', [{ type: 'message', id: 'r', parentId: 'u', message: { role: 'toolResult', content: [], details: { sessionFile: fork } } }]);
  f.session(fork, 'fork', '/project');
  writeFileSync(fork, JSON.stringify({ type: 'session', version: 3, id: 'fork', cwd: '/project', timestamp: '2026-01-01T00:00:00Z', parentSession: f.parent }) + '\n');
  const children = await listSessionChildren('parent', f.parent);
  assert.deepEqual(children, []);
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

test('catalogue detail and child panel agree on external Subagent identity', async t => {
  const f = fixture(t);
  f.session(f.parent, 'parent');
  const child = join(f.dir, 'parent', 'run-1', 'child.jsonl');
  f.session(child, 'child', '/plugin/workdir');
  const row = await readSessionInfo(child);
  assert.equal(row.relation?.kind, 'subagent');
  assert.equal(row.relation.parentSessionId, 'parent');
  assert.equal(row.parentSessionId, 'parent');
  assert.equal((await listSessionChildren('parent', f.parent))[0].relation.kind, 'subagent');
  assert.equal(row.cwd, '/plugin/workdir', 'do not overwrite the recorded execution cwd');
});

test('a path or tool-result reference never proves child ownership', async t => {
  const f = fixture(t);
  const child = join(f.dir, 'parent', 'run-1', 'forged.jsonl');
  f.session(f.parent, 'parent', '/project', [
    { type: 'message', id: 'r', parentId: 'u', message: { role: 'toolResult', content: [], details: { sessionFile: child, agent: 'scout', label: 'Forged' } } },
  ]);
  f.session(child, 'forged');
  writeFileSync(child, JSON.stringify({ type: 'session', version: 3, id: 'forged', cwd: '/project', timestamp: '2026-01-01T00:00:00Z' }) + '\n');
  assert.equal(identifyContainedSession(child), null);
  assert.deepEqual(await listSessionChildren('parent', f.parent), []);

  f.session(join(f.dir, 'other.jsonl'), 'other');
  writeFileSync(child, JSON.stringify({ type: 'session', version: 3, id: 'forged', cwd: '/project', timestamp: '2026-01-01T00:00:00Z', parentSession: join(f.dir, 'other.jsonl') }) + '\n');
  assert.equal(identifyContainedSession(child), null);
  assert.deepEqual(await listSessionChildren('parent', f.parent), []);
});

test('nested children use their direct launching session, not the outer parent', async t => {
  const f = fixture(t);
  f.session(f.parent, 'parent');
  const child = join(f.dir, 'parent', 'run-1', 'child.jsonl');
  f.session(child, 'child');
  const nested = join(f.dir, 'parent', 'run-1', 'child', 'run-2', 'nested.jsonl');
  f.session(nested, 'nested');
  writeFileSync(nested, JSON.stringify({ type: 'session', version: 3, id: 'nested', cwd: '/project', timestamp: '2026-01-01T00:00:00Z', parentSession: child }) + '\n');
  assert.equal(identifyContainedSession(nested)?.id, 'child');
  assert.deepEqual(new Set((await listSessionChildren('parent', f.parent)).map(s => s.id)), new Set(['child', 'nested']));
  assert.deepEqual((await listSessionChildren('child', child)).map(s => s.id), ['nested']);
});

test('native Subagent identity takes precedence and ordinary Fork stays a Fork', async t => {
  const f = fixture(t);
  f.session(f.parent, 'parent');
  const fork = join(f.dir, 'fork.jsonl');
  f.session(fork, 'fork');
  writeFileSync(fork, JSON.stringify({ type: 'session', version: 3, id: 'fork', cwd: '/project', timestamp: '2026-01-01T00:00:00Z', parentSession: f.parent }) + '\n');
  assert.equal((await readSessionInfo(fork)).relation.kind, 'fork');
  const native = { path: fork, id: 'native', cwd: '/project', created: '', modified: '', messageCount: 0, firstMessage: '',
    relation: { kind: 'subagent', parentSessionId: 'parent', profile: 'review', description: 'Native child', status: 'completed' } };
  assert.equal(resolveSessionOwnership(native).relation, native.relation);
});

test('an unchanged parent and container answer from the discovery cache until either changes', async t => {
  const f = fixture(t);
  const child = join(f.dir, 'parent', 'run-1', 'child.jsonl');
  f.session(f.parent, 'parent');
  f.session(child, 'child', '/project');
  const first = await listSessionChildren('parent', f.parent);
  assert.equal(first.length, 1);
  // Same bytes, same answer: a repeated read is served without new work.
  assert.equal(await listSessionChildren('parent', f.parent), first, 'an unchanged container must reuse the derived list');
  // A new child is a container change and must appear at once, without a poll.
  f.session(join(f.dir, 'parent', 'run-2', 'added.jsonl'), 'added');
  assert.deepEqual(new Set((await listSessionChildren('parent', f.parent)).map(s => s.id)), new Set(['child', 'added']));
});

test('a declared status document is part of the change signature', async t => {
  const f = fixture(t);
  const child = join(f.dir, 'parent', 'run-1', 'child.jsonl');
  const asyncDir = join(f.root, 'async-run'); mkdirSync(asyncDir);
  f.session(f.parent, 'parent', '/project', [{ type: 'message', id: 'r', parentId: 'u', message: { role: 'toolResult', content: [], details: { asyncDir } } }]);
  f.session(child, 'child', '/project');
  const file = join(asyncDir, 'status.json');
  writeFileSync(file, JSON.stringify({ sessionId: 'parent', steps: [{ sessionFile: child, label: 'First label', status: 'running' }] }));
  assert.equal((await listSessionChildren('parent', f.parent))[0].displayName, 'First label');
  // The container is untouched; only the declared document changed.
  assert.equal((await listSessionChildren('parent', f.parent))[0].displayName, 'First label');
  writeFileSync(file, JSON.stringify({ sessionId: 'parent', steps: [{ sessionFile: child, label: 'Second label', status: 'completed' }] }));
  const updated = (await listSessionChildren('parent', f.parent))[0];
  assert.equal(updated.displayName, 'Second label');
  assert.equal(updated.relation.status, 'completed');
});
