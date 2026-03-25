/**
 * Scheduler — manages per-origin poll loops.
 * One loop per unique origin across all subscriptions.
 */

import { CursorStore } from './cursor-store.js';
import { Dedup } from './dedup.js';
import { SubscriptionRegistry } from './registry.js';
import type { ChannelEvent, ChannelSink, ChannelSource, SourcePollConfig } from './types.js';

const DEFAULT_INTERVAL_MS = 60_000;
const MIN_INTERVAL_MS = 10_000;
const MAX_BACKOFF_MS = 5 * 60_000;

/** Factory that creates a fresh sink instance per subscription. */
export type SinkFactory = (name: string, config: Record<string, unknown>) => ChannelSink;

interface SubscriptionSink {
  subscriptionId: string;
  sink: ChannelSink;
}

interface OriginLoop {
  origin: string;
  source: ChannelSource;
  pollConfig: SourcePollConfig;
  sinks: SubscriptionSink[];
  timer: ReturnType<typeof setTimeout> | null;
  intervalMs: number;
  consecutiveErrors: number;
}

export class Scheduler {
  private readonly loops = new Map<string, OriginLoop>();
  private running = false;

  constructor(
    private readonly sources: Map<string, ChannelSource>,
    private readonly sinkFactory: SinkFactory,
    private readonly registry: SubscriptionRegistry,
    private readonly cursors: CursorStore,
    private readonly dedup: Dedup,
  ) {}

  async start(): Promise<void> {
    this.running = true;
    const origins = this.registry.origins();

    for (const origin of origins) {
      await this.startOriginLoop(origin);
    }
  }

  stop(): void {
    this.running = false;
    for (const loop of this.loops.values()) {
      if (loop.timer) clearTimeout(loop.timer);
    }
    this.loops.clear();
  }

  private async startOriginLoop(origin: string): Promise<void> {
    if (this.loops.has(origin)) return;

    // Parse origin → source + config
    const [sourceName] = origin.split(':', 1);
    const source = this.sources.get(sourceName);
    if (!source) {
      console.error(`[channel] Unknown source "${sourceName}" for origin "${origin}"`);
      return;
    }

    const pollConfig = source.parseOrigin(origin);
    if (!pollConfig) {
      console.error(`[channel] Source "${sourceName}" cannot parse origin "${origin}"`);
      return;
    }

    // Create a dedicated sink instance per subscription
    const subs = this.registry.forOrigin(origin);
    const sinkInstances: SubscriptionSink[] = [];
    for (const sub of subs) {
      try {
        const sink = this.sinkFactory(sub.sink, sub.sinkConfig);
        await sink.init(sub.sinkConfig);
        sinkInstances.push({ subscriptionId: sub.id, sink });
      } catch (e) {
        console.error(`[channel] Failed to init sink "${sub.sink}" for subscription ${sub.id}:`, e);
      }
    }

    if (sinkInstances.length === 0) {
      console.error(`[channel] No valid sinks for origin "${origin}", skipping.`);
      return;
    }

    // Use subscription-level interval override, or default
    const overrideMs = subs.reduce((min, s) => {
      if (s.intervalMs > 0 && s.intervalMs < min) return s.intervalMs;
      return min;
    }, DEFAULT_INTERVAL_MS);

    const loop: OriginLoop = {
      origin,
      source,
      pollConfig,
      sinks: sinkInstances,
      timer: null,
      intervalMs: Math.max(overrideMs, MIN_INTERVAL_MS),
      consecutiveErrors: 0,
    };

    this.loops.set(origin, loop);
    void this.tick(loop);
  }

  private async tick(loop: OriginLoop): Promise<void> {
    if (!this.running) return;

    try {
      const cursorEntry = this.cursors.get(loop.origin);
      const cursor = cursorEntry?.cursor ?? null;

      const result = await loop.source.poll(loop.pollConfig, cursor);

      // Dedup
      const fresh: ChannelEvent[] = [];
      for (const event of result.events) {
        const dedupKey = `${loop.origin}:${event.id}`;
        if (!this.dedup.isDuplicate(dedupKey)) {
          this.dedup.add(dedupKey);
          fresh.push(event);
        }
      }

      // Deliver to each subscription's dedicated sink
      let allDelivered = true;
      if (fresh.length > 0) {
        for (const { subscriptionId, sink } of loop.sinks) {
          try {
            await sink.deliver(fresh);
          } catch (e) {
            allDelivered = false;
            console.error(`[channel] Sink delivery failed for subscription ${subscriptionId}:`, e);
          }
        }
      }

      // Only advance cursor if ALL sinks succeeded (or no events).
      // This prevents data loss: a failing sink will see the same events
      // on the next poll rather than missing them forever.
      if (fresh.length === 0 || allDelivered) {
        this.cursors.set(loop.origin, result.cursor, fresh.length);
        await this.cursors.save();
      }

      // Reset backoff on success
      loop.consecutiveErrors = 0;

      // Respect server-recommended interval
      if (result.recommendedIntervalMs && result.recommendedIntervalMs > loop.intervalMs) {
        loop.intervalMs = result.recommendedIntervalMs;
      }
    } catch (e) {
      loop.consecutiveErrors++;
      console.error(`[channel] Poll failed for "${loop.origin}" (attempt ${loop.consecutiveErrors}):`, e);
    }

    // Schedule next tick with backoff
    const backoff = loop.consecutiveErrors > 0
      ? Math.min(loop.intervalMs * Math.pow(2, loop.consecutiveErrors - 1), MAX_BACKOFF_MS)
      : loop.intervalMs;

    loop.timer = setTimeout(() => void this.tick(loop), backoff);
  }
}
