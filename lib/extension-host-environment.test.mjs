import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { createJiti } from 'jiti';

const { registerNodeInstrumentation } = await createJiti(import.meta.url, { tsconfigPaths: true }).import('../instrumentation-node.ts');
const hostRootKey = 'PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT';

function restoreStartupState(t) {
  const previous = process.env[hostRootKey];
  const signals = new Map(['SIGINT', 'SIGTERM'].map(signal => [signal, new Set(process.listeners(signal))]));
  t.after(() => {
    if (previous === undefined) delete process.env[hostRootKey];
    else process.env[hostRootKey] = previous;
    for (const [signal, previousListeners] of signals) {
      for (const listener of process.listeners(signal)) {
        if (!previousListeners.has(listener)) process.removeListener(signal, listener);
      }
    }
  });
}

test('Node startup gives detached extension runners the installed SDK host package', t => {
  restoreStartupState(t);
  delete process.env[hostRootKey];
  registerNodeInstrumentation();
  const root = process.env[hostRootKey];
  assert.ok(root, 'background runners must receive the SDK root before extension loading');
  assert.equal(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name, '@earendil-works/pi-coding-agent');
});

test('Node startup preserves an explicitly configured extension runner host', t => {
  restoreStartupState(t);
  process.env[hostRootKey] = '/explicit/sdk';
  registerNodeInstrumentation();
  assert.equal(process.env[hostRootKey], '/explicit/sdk');
});
