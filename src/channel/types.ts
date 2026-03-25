/**
 * Channel — Event subscription protocol for OpenCLI.
 *
 * Core types: events, sources, sinks, subscriptions.
 */

/** Unified event envelope emitted by all sources. */
export interface ChannelEvent {
  /** Globally unique event ID (used for dedup). */
  id: string;
  /** Which source adapter produced this event. */
  source: string;
  /** Platform-specific event type (dot-namespaced). */
  type: string;
  /** When the event occurred on the platform (ISO-8601). */
  timestamp: string;
  /**
   * Origin identifier — what subscriptions match against.
   * Format: `source:path` e.g. `github:user/repo#42`
   */
  origin: string;
  /** Platform-specific event data. */
  payload: Record<string, unknown>;
}

/** A source adapter knows how to poll a specific platform for events. */
export interface ChannelSource {
  readonly name: string;

  /** Return human-readable list of subscribable items for discovery. */
  listSubscribable(config: Record<string, unknown>): Promise<SubscribableItem[]>;

  /**
   * Parse an origin string into source-specific config.
   * e.g. "github:user/repo#42" → { owner: "user", repo: "repo", issue: 42 }
   * Returns null if this source can't handle the origin.
   */
  parseOrigin(origin: string): SourcePollConfig | null;

  /**
   * Poll for new events since cursor.
   * Returns events + new cursor position.
   */
  poll(config: SourcePollConfig, cursor: string | null): Promise<PollResult>;
}

export interface SubscribableItem {
  origin: string;
  description: string;
}

export interface SourcePollConfig {
  [key: string]: unknown;
}

export interface PollResult {
  events: ChannelEvent[];
  cursor: string;
  /** Server-recommended poll interval in ms (e.g. GitHub X-Poll-Interval). */
  recommendedIntervalMs?: number;
}

/** A sink adapter knows how to deliver events to a consumer. */
export interface ChannelSink {
  readonly name: string;
  init(config: Record<string, unknown>): Promise<void>;
  deliver(events: ChannelEvent[]): Promise<void>;
}

/** A subscription: consumer → origin mapping. */
export interface Subscription {
  /** Unique subscription ID. */
  id: string;
  /** Origin pattern to match, e.g. "github:user/repo#42". */
  origin: string;
  /** Sink name to deliver to. */
  sink: string;
  /** Sink-specific config. */
  sinkConfig: Record<string, unknown>;
  /** Poll interval override in ms (0 = use source default). */
  intervalMs: number;
  /** When this subscription was created. */
  createdAt: string;
}
