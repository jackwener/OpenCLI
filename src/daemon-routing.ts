/**
 * Pure routing logic for the opencli daemon's multi-profile connection pool.
 *
 * Extracted from daemon.ts so the routing rules (hello parsing + command
 * target resolution) can be unit-tested without spinning up servers or
 * mocking WebSockets.
 */

/** Lightweight view of a connected extension, enough to route against. */
export interface ProfileSummary {
  profileId: string;
  profileLabel: string;
}

/** Fields the daemon cares about from the extension's hello handshake. */
export interface ParsedHello {
  /** UUID generated and persisted by the extension. Missing on pre-multiplex extensions. */
  profileId?: string;
  /** Human-readable label the extension chose (falls back to Profile-<uuid-prefix>). */
  profileLabel?: string;
  version: string | null;
  compatRange: string | null;
}

/**
 * Parse a message off the WebSocket and validate it is a hello.
 * Returns null for anything else (other message types are handled elsewhere).
 */
export function parseHello(msg: unknown): ParsedHello | null {
  if (!msg || typeof msg !== 'object') return null;
  const m = msg as Record<string, unknown>;
  if (m.type !== 'hello') return null;
  return {
    profileId: typeof m.profileId === 'string' && m.profileId ? m.profileId : undefined,
    profileLabel: typeof m.profileLabel === 'string' && m.profileLabel ? m.profileLabel : undefined,
    version: typeof m.version === 'string' ? m.version : null,
    compatRange: typeof m.compatRange === 'string' ? m.compatRange : null,
  };
}

/** Result of routing a /command to a specific profile. */
export type RouteResolution =
  | { ok: true; profileId: string }
  | { ok: false; status: number; error: string; connected?: ProfileSummary[] };

/**
 * Decide which connected profile a /command should be sent to.
 *
 * Rules (kept deliberately boring so reviewers can reason about edge cases):
 *   - 0 connected → 503 (matches pre-multiplex behaviour).
 *   - `profile` supplied → match by profileId OR profileLabel; 404 if absent.
 *   - `profile` absent + exactly 1 connected → auto-route (single-profile users
 *     never see a prompt; backward-compatible with today's UX).
 *   - `profile` absent + ≥2 connected → 409 with the list so the caller can
 *     produce an actionable error message.
 *
 * The daemon does not own the notion of a "default profile" — that is the
 * CLI's job to resolve from ~/.opencli/config.json / OPENCLI_PROFILE before
 * the command ever reaches here. Keeps this function pure.
 */
export function resolveRoute(
  requestedProfile: string | undefined,
  connected: ProfileSummary[],
): RouteResolution {
  if (connected.length === 0) {
    return {
      ok: false,
      status: 503,
      error: 'Extension not connected. Please install the opencli Browser Bridge extension.',
    };
  }

  if (requestedProfile) {
    const match = connected.find(
      (c) => c.profileId === requestedProfile || c.profileLabel === requestedProfile,
    );
    if (match) return { ok: true, profileId: match.profileId };
    return {
      ok: false,
      status: 404,
      error: `Profile "${requestedProfile}" not connected.`,
      connected,
    };
  }

  if (connected.length === 1) {
    return { ok: true, profileId: connected[0].profileId };
  }

  return {
    ok: false,
    status: 409,
    error:
      'Multiple profiles connected. Pick one with --profile <name>, or set a default with `opencli profile use <name>` or OPENCLI_PROFILE.',
    connected,
  };
}
