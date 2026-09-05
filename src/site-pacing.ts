/**
 * Per-site navigation pacing and security-block circuit breaker.
 *
 * Sites with velocity-based risk control (xiaohongshu, weibo) soft-block
 * accounts that navigate faster than a human. The adapters already jitter
 * their own settle waits, but nothing spaced *separate CLI invocations* —
 * a batch caller could fire navigations back-to-back. The daemon is the one
 * local process that sees every CLI client (same argument as
 * session-lease.ts), so it enforces the pitfall-doc rules centrally:
 *
 *  - consecutive `navigate` dispatches for the same (contextId, site) are
 *    spaced by a jittered per-site interval, and
 *  - repeated SECURITY_BLOCK outcomes open a randomized cooldown during
 *    which navigations fail fast with `security_cooldown` + retryAfterMs
 *    instead of hammering a hot risk state (escalation path per #842/#677).
 *
 * Pure logic, no I/O, injectable clock/rand — testable without Chrome.
 */

export interface SitePacingRule {
  minIntervalMs: number;
  maxIntervalMs: number;
}

/**
 * Sites with documented velocity-based risk control. Bounds follow the
 * site's own pitfall docs (sitemaps/xiaohongshu/pitfalls.md: keep 1-2s
 * between consecutive requests).
 */
export const SITE_PACING_RULES: Readonly<Record<string, SitePacingRule>> = {
  xiaohongshu: { minIntervalMs: 1500, maxIntervalMs: 3000 },
  weibo: { minIntervalMs: 1000, maxIntervalMs: 2000 },
};

/** Machine-readable error code for the breaker-open fast-fail response. */
export const SECURITY_COOLDOWN_CODE = 'security_cooldown';

/** Security blocks inside this window count toward opening the breaker. */
export const PACING_BREAKER_WINDOW_MS = 10 * 60_000;
/** Blocks inside the window needed to open the breaker. */
export const PACING_BREAKER_THRESHOLD = 2;
/** Randomized breaker-open duration bounds. */
export const PACING_COOLDOWN_MIN_MS = 5 * 60_000;
export const PACING_COOLDOWN_MAX_MS = 10 * 60_000;

/** `site:xiaohongshu` / `site:weibo:<uuid>` → site name; anything else → null. */
export function parseSiteFromSession(session: unknown): string | null {
  if (typeof session !== 'string') return null;
  const match = /^site:([^:]+)/.exec(session);
  return match ? match[1] : null;
}

/**
 * Daemon-side hook predicate: an adapter `navigate` dispatch whose session
 * belongs to a paced site. Everything else (evaluates, browser-surface
 * commands, unpaced sites) passes through unexamined.
 */
export function classifyPacedNavigation(
  body: { action?: unknown; surface?: unknown; session?: unknown },
  rules: Readonly<Record<string, SitePacingRule>> = SITE_PACING_RULES,
): string | null {
  if (body.action !== 'navigate' || body.surface !== 'adapter') return null;
  const site = parseSiteFromSession(body.session);
  return site && rules[site] ? site : null;
}

export interface SecurityCooldownFailure {
  message: string;
  errorCode: typeof SECURITY_COOLDOWN_CODE;
  errorHint: string;
  retryAfterMs: number;
  status: 429;
}

/** Fast-fail response body for a navigation refused while the breaker is open. */
export function buildSecurityCooldownFailure(site: string, retryAfterMs: number): SecurityCooldownFailure {
  const retryAfterS = Math.ceil(retryAfterMs / 1000);
  return {
    message: `${site} is cooling down after repeated security blocks; navigation refused to avoid escalating risk control.`,
    errorCode: SECURITY_COOLDOWN_CODE,
    errorHint: `Retry after ${retryAfterS}s. Repeated blocks escalate toward account restrictions — do not lower the cooldown.`,
    retryAfterMs,
    status: 429,
  };
}

export type PacingOutcome =
  | { granted: true; delayMs: number }
  | { granted: false; retryAfterMs: number };

export class SitePacer {
  private readonly rules: Readonly<Record<string, SitePacingRule>>;
  private readonly rand: () => number;
  /** Last assigned navigation slot per contextId␟site. */
  private readonly lastSlot = new Map<string, number>();
  /** Recent security-block timestamps per contextId␟site. */
  private readonly blocks = new Map<string, number[]>();
  /** Breaker-open deadline per contextId␟site. */
  private readonly openUntil = new Map<string, number>();

  constructor(rules: Readonly<Record<string, SitePacingRule>> = SITE_PACING_RULES, rand: () => number = Math.random) {
    this.rules = rules;
    this.rand = rand;
  }

  private key(contextId: string, site: string): string {
    return `${contextId}␟${site}`;
  }

  /**
   * Reserve the next navigation slot for (contextId, site). Concurrent
   * callers get consecutive slots (lastSlot advances on every grant), so a
   * burst of CLI invocations serializes without locks. Returns the delay the
   * caller must wait before dispatching, or a breaker rejection.
   */
  acquireNavigationSlot(contextId: string, site: string, now: number): PacingOutcome {
    const rule = this.rules[site];
    if (!rule) return { granted: true, delayMs: 0 };
    const key = this.key(contextId, site);

    const open = this.openUntil.get(key);
    if (open !== undefined) {
      if (open > now) return { granted: false, retryAfterMs: open - now };
      this.openUntil.delete(key);
      this.blocks.delete(key);
    }

    const interval = rule.minIntervalMs + this.rand() * (rule.maxIntervalMs - rule.minIntervalMs);
    const previous = this.lastSlot.get(key);
    const slot = previous === undefined ? now : Math.max(now, previous + interval);
    this.lastSlot.set(key, slot);
    return { granted: true, delayMs: slot - now };
  }

  /**
   * Record a command outcome. `security_block` outcomes accumulate toward the
   * breaker; any `ok` clears the count (the site let us back in — the state
   * is not hot). Unpaced sites are ignored entirely.
   */
  reportOutcome(contextId: string, site: string, outcome: 'ok' | 'security_block', now: number): void {
    if (!this.rules[site]) return;
    const key = this.key(contextId, site);
    if (outcome === 'ok') {
      this.blocks.delete(key);
      return;
    }
    const recent = (this.blocks.get(key) ?? []).filter((t) => now - t < PACING_BREAKER_WINDOW_MS);
    recent.push(now);
    if (recent.length >= PACING_BREAKER_THRESHOLD) {
      const openMs = PACING_COOLDOWN_MIN_MS + this.rand() * (PACING_COOLDOWN_MAX_MS - PACING_COOLDOWN_MIN_MS);
      this.openUntil.set(key, now + openMs);
      this.blocks.delete(key);
      return;
    }
    this.blocks.set(key, recent);
  }
}
