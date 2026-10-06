import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir, getPackageDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file";

const PI_CODING_AGENT_PACKAGE = "@earendil-works/pi-coding-agent";
export const PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT = "PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT";
export const DEFAULT_NICOBAILON_GLOBAL_CONCURRENCY_LIMIT = 20;

type NicobailonConfig = Record<string, unknown> & {
  globalConcurrencyLimit?: unknown;
};

export function getNicobailonConfigPath(agentDir = getAgentDir()): string {
  return join(agentDir, "extensions", "subagent", "config.json");
}

function readConfig(configPath: string): NicobailonConfig {
  if (!existsSync(configPath)) return {};
  const parsed: unknown = JSON.parse(readFileSync(configPath, "utf8"));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid nicobailon/pi-subagents config: expected an object");
  }
  return parsed as NicobailonConfig;
}

export function readNicobailonGlobalConcurrencyLimit(
  configPath = getNicobailonConfigPath(),
): number {
  const value = readConfig(configPath).globalConcurrencyLimit;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1
    ? value
    : DEFAULT_NICOBAILON_GLOBAL_CONCURRENCY_LIMIT;
}

export function writeNicobailonGlobalConcurrencyLimit(
  value: number,
  configPath = getNicobailonConfigPath(),
): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error("globalConcurrencyLimit must be a positive safe integer");
  }
  const config = readConfig(configPath);
  mkdirSync(dirname(configPath), { recursive: true });
  writePrivateFileAtomicSync(configPath, JSON.stringify({
    ...config,
    globalConcurrencyLimit: value,
  }, null, 2));
  return readNicobailonGlobalConcurrencyLimit(configPath);
}

export function resolvePiCodingAgentPackageRoot(): string | undefined {
  try {
    // This is the package directory of the exact SDK instance Pi Web imported.
    // Unlike createRequire(import.meta.url), it survives Next.js server bundling
    // because the SDK itself owns the lookup.
    const root = realpathSync(getPackageDir());
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { name?: unknown };
    return pkg.name === PI_CODING_AGENT_PACKAGE ? root : undefined;
  } catch {
    return undefined;
  }
}

/**
 * pi-subagents computes its detached-runner host root when its module loads.
 * Pi Web is a wrapper host, so process.argv[1] does not point into the Pi SDK.
 * Seed the documented override before the resource loader imports pi-subagents.
 */
export function ensureNicobailonHostEnvironment(
  env: NodeJS.ProcessEnv = process.env,
  resolveRoot: () => string | undefined = resolvePiCodingAgentPackageRoot,
): string | undefined {
  const existing = env[PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT]?.trim();
  if (existing) return existing;
  const root = resolveRoot();
  if (!root) return undefined;
  env[PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT] = root;
  return root;
}
