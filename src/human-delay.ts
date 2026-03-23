/**
 * Human-like delay system for anti-detection.
 *
 * Uses log-normal distribution to simulate natural browsing patterns:
 * - Most delays cluster around the median (feels natural)
 * - Occasional longer delays (simulates reading/thinking)
 * - Periodic "breaks" (simulates distraction or task switching)
 *
 * Addresses: https://github.com/jackwener/opencli/issues/59 (P0: request interval jitter)
 */

// ─── Delay Profiles ─────────────────────────────────────────────────

export interface DelayProfile {
  /** Log-normal mu parameter (controls median delay) */
  mu: number;
  /** Log-normal sigma parameter (controls spread) */
  sigma: number;
  /** Minimum delay in ms */
  minMs: number;
  /** Maximum delay in ms */
  maxMs: number;
  /** Break interval: take a long pause every N actions (0 to disable) */
  breakEveryMin: number;
  /** Break interval max (actual interval randomized between min..max) */
  breakEveryMax: number;
  /** Break duration range in ms [min, max] */
  breakDurationMs: [number, number];
}

export const PROFILES: Record<string, DelayProfile> = {
  /** No delays — for CI, testing, or trusted environments */
  none: {
    mu: 0, sigma: 0, minMs: 0, maxMs: 0,
    breakEveryMin: 0, breakEveryMax: 0, breakDurationMs: [0, 0],
  },
  /** Light jitter — minimal detection risk, fast throughput */
  fast: {
    mu: 6.9, sigma: 0.3, minMs: 500, maxMs: 3000,
    breakEveryMin: 0, breakEveryMax: 0, breakDurationMs: [0, 0],
  },
  /** Moderate — balanced speed and safety (default) */
  moderate: {
    mu: 7.6, sigma: 0.4, minMs: 1000, maxMs: 8000,
    breakEveryMin: 15, breakEveryMax: 25, breakDurationMs: [5000, 15000],
  },
  /** Conservative — for aggressive anti-bot sites */
  cautious: {
    mu: 8.3, sigma: 0.5, minMs: 3000, maxMs: 25000,
    breakEveryMin: 8, breakEveryMax: 12, breakDurationMs: [15000, 60000],
  },
  /** Stealth — maximum evasion, very slow */
  stealth: {
    mu: 9.0, sigma: 0.5, minMs: 5000, maxMs: 40000,
    breakEveryMin: 6, breakEveryMax: 10, breakDurationMs: [30000, 90000],
  },
};

// ─── Delay Generator ────────────────────────────────────────────────

/**
 * Stateful delay generator that tracks action count for periodic breaks.
 */
export class HumanDelay {
  private _profile: DelayProfile;
  private _actionCount = 0;
  private _nextBreakAt = 0;

  constructor(profile?: string | DelayProfile) {
    if (typeof profile === 'string') {
      this._profile = PROFILES[profile] ?? PROFILES.moderate;
    } else {
      this._profile = profile ?? PROFILES.moderate;
    }
    this._scheduleNextBreak();
  }

  get profileName(): string {
    for (const [name, p] of Object.entries(PROFILES)) {
      if (p === this._profile) return name;
    }
    return 'custom';
  }

  /** Generate a log-normal random delay in ms. */
  private _lognormalDelay(): number {
    const { mu, sigma, minMs, maxMs } = this._profile;
    if (maxMs <= 0) return 0;

    // Box-Muller transform for normal distribution
    const u1 = Math.random();
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const raw = Math.exp(mu / 1000 + sigma * z); // scale mu from "micro" to seconds-ish

    return Math.max(minMs, Math.min(raw * 1000, maxMs));
  }

  private _scheduleNextBreak(): void {
    const { breakEveryMin, breakEveryMax } = this._profile;
    if (breakEveryMin <= 0) {
      this._nextBreakAt = Infinity;
      return;
    }
    this._nextBreakAt = this._actionCount +
      breakEveryMin + Math.floor(Math.random() * (breakEveryMax - breakEveryMin + 1));
  }

  /** Return the delay to wait (in ms) before the next action. */
  next(): number {
    if (this._profile.maxMs <= 0) return 0;

    this._actionCount++;

    // Check if it's time for a break
    if (this._actionCount >= this._nextBreakAt) {
      this._scheduleNextBreak();
      const [minBreak, maxBreak] = this._profile.breakDurationMs;
      return minBreak + Math.random() * (maxBreak - minBreak);
    }

    return this._lognormalDelay();
  }

  /** Convenience: await this to sleep for the computed delay. */
  async sleep(): Promise<number> {
    const ms = this.next();
    if (ms > 0) {
      await new Promise(resolve => setTimeout(resolve, ms));
    }
    return ms;
  }

  /** Reset action counter (e.g., between different command sessions). */
  reset(): void {
    this._actionCount = 0;
    this._scheduleNextBreak();
  }
}

// ─── Module-level helpers ───────────────────────────────────────────

/**
 * Resolve the active delay profile from environment or explicit name.
 *
 * Priority:
 *   1. Explicit `profile` argument
 *   2. OPENCLI_DELAY_PROFILE env var
 *   3. 'none' when CI=true (to avoid test timeouts)
 *   4. 'moderate' default
 */
export function resolveProfile(profile?: string): DelayProfile {
  // In CI environments, default to 'none' to avoid test timeouts.
  // Explicit OPENCLI_DELAY_PROFILE or profile argument always takes precedence.
  const ciDefault = process.env.CI ? 'none' : 'moderate';
  const name = profile ?? process.env.OPENCLI_DELAY_PROFILE ?? ciDefault;
  return PROFILES[name] ?? PROFILES.moderate;
}

/**
 * One-shot jitter: returns a random delay in ms using the resolved profile.
 * Stateless — does not track break intervals.
 */
export function jitterMs(profile?: string): number {
  const p = resolveProfile(profile);
  if (p.maxMs <= 0) return 0;
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const raw = Math.exp(p.mu / 1000 + p.sigma * z);
  return Math.max(p.minMs, Math.min(raw * 1000, p.maxMs));
}

/**
 * One-shot sleep with jitter.
 */
export async function humanSleep(profile?: string): Promise<number> {
  const ms = jitterMs(profile);
  if (ms > 0) await new Promise(r => setTimeout(r, ms));
  return ms;
}
