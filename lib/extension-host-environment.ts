import { getPackageDir } from '@earendil-works/pi-coding-agent';
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

const HOST_PACKAGE_ROOT_ENV = 'PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT';

function resolveSdkPackageRoot(): string | undefined {
  try {
    // Use the exact SDK instance imported by Pi Web, including under Next bundling.
    const root = realpathSync(getPackageDir());
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    return pkg.name === '@earendil-works/pi-coding-agent' ? root : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A wrapper host's argv points at Next, not the Pi CLI. Supply pi-subagents'
 * documented detached-runner override before loading extensions; it captures
 * the host location at module initialization. No plugin settings are changed.
 */
export function ensureExtensionHostEnvironment(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const explicit = env[HOST_PACKAGE_ROOT_ENV]?.trim();
  if (explicit) return explicit;
  const root = resolveSdkPackageRoot();
  if (root) env[HOST_PACKAGE_ROOT_ENV] = root;
  return root;
}
