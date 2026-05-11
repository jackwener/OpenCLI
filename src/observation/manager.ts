import { ObservationSession, type ObservationSessionOptions } from './session.js';
import type { ObservationScope } from './events.js';

export class ObservationManager {
  private readonly sessions = new Map<string, ObservationSession>();

  start(opts: ObservationSessionOptions): ObservationSession {
    const session = new ObservationSession(opts);
    this.sessions.set(session.id, session);
    return session;
  }

  get(id: string): ObservationSession | undefined {
    return this.sessions.get(id);
  }

  stop(id: string): ObservationSession | undefined {
    const session = this.sessions.get(id);
    this.sessions.delete(id);
    return session;
  }

  findByScope(scope: ObservationScope): ObservationSession[] {
    return [...this.sessions.values()].filter((session) => scopeMatches(session.scope, scope));
  }
}

function scopeMatches(actual: ObservationScope, expected: ObservationScope): boolean {
  return actual.session === expected.session
    && (expected.contextId === undefined || actual.contextId === expected.contextId)
    && (expected.target === undefined || actual.target === expected.target)
    && (expected.site === undefined || actual.site === expected.site)
    && (expected.command === undefined || actual.command === expected.command);
}
