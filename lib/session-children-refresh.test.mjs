import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url);
const { runningFamilyKey } = await jiti.import('./session-children-refresh.ts');

const child = (id, status) => ({ id, relation: { kind: 'subagent', parentSessionId: 'parent', profile: 'worker', description: 'a task', status } });

test('a detached child keeps its family polled while only its relation says it runs', () => {
  // An extension-run async child has no web runtime, so runningIds stays empty
  // and the relation status is the only liveness signal.
  const key = runningFamilyKey([{ id: 'parent' }, child('child', 'running')], new Set());
  assert.equal(key, 'child');
});

test('a finished family is never polled', () => {
  assert.equal(runningFamilyKey([{ id: 'parent' }, child('child', 'completed')], new Set()), '');
  assert.equal(runningFamilyKey([{ id: 'parent' }, child('child', 'failed')], new Set()), '');
  assert.equal(runningFamilyKey([{ id: 'parent' }], new Set()), '');
});

test('a live web runtime alone also counts, and the key flips when a run ends', () => {
  const family = [{ id: 'parent' }, child('child', 'completed')];
  assert.equal(runningFamilyKey(family, new Set(['parent'])), 'parent');
  assert.equal(runningFamilyKey(family, new Set()), '');
  // The same flip that ends the poll: running child -> completed child.
  assert.equal(runningFamilyKey([{ id: 'parent' }, child('child', 'running')], new Set()), 'child');
});

test('the key is order-independent so a refetch does not restart the interval', () => {
  const running = new Set(['b']);
  assert.equal(runningFamilyKey([{ id: 'a' }, { id: 'b' }], running), runningFamilyKey([{ id: 'b' }, { id: 'a' }], running));
});
