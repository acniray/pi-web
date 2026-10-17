const SESSION_LIVENESS_PROTOCOL_VERSION = 1;
export const SESSION_LIVENESS_REGISTRY_KEY = "@agegr/pi-web/session-liveness/v1";
export const SESSION_LIVENESS_LEASE_TTL_MS = 90_000;
const SESSION_LIVENESS_LEASES_KEY = "@agegr/pi-web/session-liveness-leases/v1";

export interface SessionLivenessProvider {
  name: string;
  sessionId: string;
  sessionFile?: string;
  isActive(): boolean;
}

export interface SessionIdentity {
  sessionId: string;
  sessionFile?: string;
}

/** pi-web's own browser keep-alive; it says a tab has the session open, not that work is running. */
const LEASE_PROVIDER_NAME = "pi-web-selected-session";

interface SessionLivenessRegistry {
  version: typeof SESSION_LIVENESS_PROTOCOL_VERSION;
  register(provider: SessionLivenessProvider): () => void;
  hasActiveProvider(session: SessionIdentity): boolean;
  // Additive queries at the same protocol version: an extension registered
  // before this file changed (or a registry left by a hot reload) may not have
  // them, so callers must treat their absence as "no work providers".
  /** Whether a work provider (anything but pi-web's own browse lease) says this session is busy. */
  hasActiveWorkProvider?(session: SessionIdentity): boolean;
  /** The session ids whose work providers report activity right now. */
  activeWorkSessionIds?(): string[];
}

export interface SessionLivenessLease {
  renew(): void;
  release(): void;
}

interface LeaseRecord extends SessionLivenessLease {
  sessionId: string;
  expiresAt: number;
  released: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

type LeaseStore = Map<string, Set<LeaseRecord>>;

function assertNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Session liveness provider ${field} must be a non-empty string`);
  }
}

function validateProvider(provider: SessionLivenessProvider): void {
  if (!provider || typeof provider !== "object") {
    throw new Error("Session liveness provider must be an object");
  }
  assertNonEmptyString(provider.name, "name");
  assertNonEmptyString(provider.sessionId, "sessionId");
  if (provider.sessionFile !== undefined) {
    assertNonEmptyString(provider.sessionFile, "sessionFile");
  }
  if (typeof provider.isActive !== "function") {
    throw new Error("Session liveness provider isActive must be a function");
  }
}

function createRegistry(): SessionLivenessRegistry {
  const providers = new Map<symbol, SessionLivenessProvider>();

  function matchesSession(provider: SessionLivenessProvider, session: SessionIdentity): boolean {
    const identities = new Set([session.sessionId, session.sessionFile].filter((value): value is string => Boolean(value)));
    return identities.has(provider.sessionId) || Boolean(provider.sessionFile && identities.has(provider.sessionFile));
  }

  function providerIsActive(provider: SessionLivenessProvider): boolean {
    try {
      const active = provider.isActive();
      if (typeof active !== "boolean") {
        throw new Error("isActive() must return a boolean");
      }
      return active;
    } catch (error) {
      console.error(`[pi-web] Session liveness provider '${provider.name}' failed; preserving the session:`, error);
      return true;
    }
  }

  /** Work providers are every registered provider except pi-web's own browse lease. */
  function workProviders(): SessionLivenessProvider[] {
    return [...providers.values()].filter((provider) => provider.name !== LEASE_PROVIDER_NAME);
  }

  return {
    version: SESSION_LIVENESS_PROTOCOL_VERSION,
    register(provider) {
      validateProvider(provider);
      const token = Symbol(provider.name);
      providers.set(token, provider);
      let disposed = false;
      return () => {
        if (disposed) return;
        disposed = true;
        providers.delete(token);
      };
    },
    hasActiveProvider(session) {
      for (const provider of providers.values()) {
        if (!matchesSession(provider, session)) continue;
        if (providerIsActive(provider)) return true;
      }
      return false;
    },
    hasActiveWorkProvider(session) {
      for (const provider of workProviders()) {
        if (!matchesSession(provider, session)) continue;
        if (providerIsActive(provider)) return true;
      }
      return false;
    },
    activeWorkSessionIds() {
      const ids = new Set<string>();
      for (const provider of workProviders()) {
        if (providerIsActive(provider)) ids.add(provider.sessionId);
      }
      return [...ids];
    },
  };
}

function isCompatibleRegistry(value: unknown): value is SessionLivenessRegistry {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SessionLivenessRegistry>;
  return candidate.version === SESSION_LIVENESS_PROTOCOL_VERSION
    && typeof candidate.register === "function"
    && typeof candidate.hasActiveProvider === "function";
}

function getRegistry(): SessionLivenessRegistry {
  const store = globalThis as Record<PropertyKey, unknown>;
  const key = Symbol.for(SESSION_LIVENESS_REGISTRY_KEY);
  const existing = store[key];
  if (isCompatibleRegistry(existing)) return existing;
  const registry = createRegistry();
  store[key] = registry;
  return registry;
}

const registry = getRegistry();

function getLeaseStore(): LeaseStore {
  const store = globalThis as Record<PropertyKey, unknown>;
  const key = Symbol.for(SESSION_LIVENESS_LEASES_KEY);
  const existing = store[key];
  if (existing instanceof Map) return existing as LeaseStore;
  const leases: LeaseStore = new Map();
  store[key] = leases;
  return leases;
}

function scheduleLeaseExpiry(lease: LeaseRecord): void {
  if (lease.timer) clearTimeout(lease.timer);
  lease.timer = setTimeout(() => {
    if (!lease.released && lease.expiresAt <= Date.now()) lease.release();
    else if (!lease.released) scheduleLeaseExpiry(lease);
  }, Math.max(1, lease.expiresAt - Date.now()));
  const unref = (lease.timer as unknown as { unref?: () => void }).unref;
  unref?.call(lease.timer);
}

/** Keep one selected browser session alive while its lease is being renewed. */
export function acquireSessionLivenessLease(sessionId: string): SessionLivenessLease {
  const leases = getLeaseStore();
  const providerRelease = registerSessionLivenessProvider({
    name: LEASE_PROVIDER_NAME,
    sessionId,
    isActive: () => !lease.released && lease.expiresAt > Date.now(),
  });
  const release = () => {
    if (lease.released) return;
    lease.released = true;
    if (lease.timer) clearTimeout(lease.timer);
    providerRelease();
    const sessionLeases = leases.get(sessionId);
    sessionLeases?.delete(lease);
    if (sessionLeases?.size === 0) leases.delete(sessionId);
  };
  const renew = () => {
    if (lease.released) return;
    lease.expiresAt = Date.now() + SESSION_LIVENESS_LEASE_TTL_MS;
    scheduleLeaseExpiry(lease);
  };
  const lease: LeaseRecord = {
    sessionId,
    expiresAt: Date.now() + SESSION_LIVENESS_LEASE_TTL_MS,
    released: false,
    timer: null,
    renew,
    release,
  };
  const sessionLeases = leases.get(sessionId) ?? new Set<LeaseRecord>();
  sessionLeases.add(lease);
  leases.set(sessionId, sessionLeases);
  scheduleLeaseExpiry(lease);
  return lease;
}

/** Renew every live browser lease for a session; expired leases are ignored. */
export function renewSessionLivenessLeases(sessionId: string): number {
  const leases = getLeaseStore().get(sessionId);
  if (!leases) return 0;
  let renewed = 0;
  for (const lease of [...leases]) {
    if (lease.released || lease.expiresAt <= Date.now()) {
      lease.release();
      continue;
    }
    lease.renew();
    renewed += 1;
  }
  return renewed;
}

/**
 * Register session-scoped work that must survive pi-web's automatic idle eviction.
 * Explicit shutdown and runtime replacement still take precedence.
 */
export function registerSessionLivenessProvider(provider: SessionLivenessProvider): () => void {
  return registry.register(provider);
}

export function hasActiveSessionLivenessProvider(session: SessionIdentity): boolean {
  return registry.hasActiveProvider(session);
}

/**
 * Whether an extension reports unfinished work (a detached child run, a pending
 * result) for this session. pi-web's own browse lease never counts: every open
 * tab would otherwise look busy. Used for the session list's working state, not
 * for prompt, awaiting-input or completion-notification decisions.
 */
export function hasActiveWorkProvider(session: SessionIdentity): boolean {
  const active = registry.hasActiveWorkProvider;
  return typeof active === "function" ? active.call(registry, session) : false;
}

/** The session ids with live extension work; empty on a registry without the query. */
export function getActiveWorkSessionIds(): string[] {
  const ids = registry.activeWorkSessionIds;
  return typeof ids === "function" ? ids.call(registry) : [];
}
