import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url);
const { sessionDisplayName, sessionIsRunning, sessionWorkspaceCwd } = await jiti.import('./session-display.ts');
const session = { id: 'child', name: 'Stored title', firstMessage: 'Task: private long prompt', relation: { kind: 'subagent', profile: 'scout', description: 'Different task description' } };
test('the same explicit display label is used everywhere instead of a task prompt', () => {
  assert.equal(sessionDisplayName({ ...session, displayName: 'Check boundaries' }), 'Check boundaries');
  assert.equal(sessionDisplayName(session), 'Stored title');
});
test('unnamed child sessions use their profile, not a raw task description', () => {
  assert.equal(sessionDisplayName({ ...session, name: undefined }), 'scout');
});
test('machine UUID suffixes stay out of child titles, but explicit labels and ordinary titles remain intact', () => {
  const name = 'subagent-scout-751a1480-4aa5-4e37-b5ae-cea8436c0cdc-1';
  assert.equal(sessionDisplayName({ ...session, name }), 'subagent-scout');
  assert.equal(sessionDisplayName({ ...session, name, displayName: name }), name);
  assert.equal(sessionDisplayName({ id: 'main', name, firstMessage: '' }), name);
});

test('external run metadata contributes to live counts without starting a web runtime', () => {
  assert.equal(sessionIsRunning({ ...session, relation: { ...session.relation, status: 'running' } }, new Set()), true);
  assert.equal(sessionIsRunning({ ...session, relation: { ...session.relation, status: 'completed' } }, new Set()), false);
  assert.equal(sessionIsRunning(session, new Set(['child'])), true);
});

test('child workspace navigation follows the parent while its execution cwd stays untouched', () => {
  const child = { ...session, cwd: '/installed/plugin', projectRoot: '/project' };
  assert.equal(sessionWorkspaceCwd(child), '/project');
  assert.equal(sessionWorkspaceCwd(child, { id: 'parent', cwd: '/project/worktree' }), '/project/worktree');
  assert.equal(child.cwd, '/installed/plugin');
  assert.equal(sessionWorkspaceCwd({ ...child, relation: undefined }), '/installed/plugin');
});

test('ordinary unnamed chats keep the first message fallback', () => {
  assert.equal(sessionDisplayName({ id: 'main', firstMessage: 'My message' }), 'My message');
});
