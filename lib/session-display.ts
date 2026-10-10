import type { SessionInfo } from './types';
import { skillExpansionToCommand } from './slash-display';

/** A child may execute in an extension directory without switching the user's workspace. */
export function sessionWorkspaceCwd(session: Pick<SessionInfo, 'id' | 'cwd' | 'projectRoot' | 'relation'>, parent?: Pick<SessionInfo, 'id' | 'cwd'> | null): string {
  if (session.relation?.kind !== 'subagent') return session.cwd;
  return (parent && parent.id !== session.id ? parent.cwd : undefined) ?? session.projectRoot ?? session.cwd;
}

export function sessionIsRunning(session: Pick<SessionInfo, 'id' | 'relation'>, liveIds: ReadonlySet<string>): boolean {
  return liveIds.has(session.id) || (session.relation?.kind === 'subagent' && session.relation.status === 'running');
}

/** One title policy shared by navigation, Agents rows and session details. */
export function sessionDisplayName(session: Pick<SessionInfo, 'id' | 'name' | 'displayName' | 'firstMessage' | 'relation'>): string {
  if (session.displayName?.trim()) return session.displayName.trim();
  if (session.name?.trim()) {
    const name = session.name.trim();
    if (session.relation?.kind !== 'subagent') return name;
    // Hide opaque execution identifiers in child titles, not authored labels.
    return name.replace(/[-_][0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:-\d+)?$/i, '') || session.relation.profile;
  }
  if (session.relation?.kind === 'subagent') return session.relation.profile || 'subagent';
  return (skillExpansionToCommand(session.firstMessage) ?? session.firstMessage).slice(0, 50) || session.id.slice(0, 12);
}
