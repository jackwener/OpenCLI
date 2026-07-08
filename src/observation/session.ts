import { RingBuffer } from './ring-buffer.js';
import type { ObservationEvent, ObservationEventInput, ObservationScope, ObservationStream } from './events.js';
import { randomBytes } from 'node:crypto';

export const DEFAULT_OBSERVATION_WINDOW_MS = 120_000;

export interface ObservationSessionOptions {
  id?: string;
  scope: ObservationScope;
  windowMs?: number;
  maxEventsPerStream?: number;
  now?: () => number;
}

export class ObservationSession {
  readonly id: string;
  readonly scope: ObservationScope;
  readonly startedAt: number;

  private readonly now: () => number;
  private counter = 0;
  private readonly buffers: Record<ObservationStream, RingBuffer<ObservationEvent>>;

  constructor(opts: ObservationSessionOptions) {
    this.id = opts.id ?? createTraceId(opts.now?.() ?? Date.now());
    this.scope = opts.scope;
    this.now = opts.now ?? Date.now;
    this.startedAt = this.now();
    const bufferOpts = {
      maxAgeMs: opts.windowMs ?? DEFAULT_OBSERVATION_WINDOW_MS,
      maxItems: opts.maxEventsPerStream ?? 1_000,
      now: this.now,
    };
    this.buffers = {
      action: new RingBuffer<ObservationEvent>(bufferOpts),
      network: new RingBuffer<ObservationEvent>(bufferOpts),
      console: new RingBuffer<ObservationEvent>(bufferOpts),
      screenshot: new RingBuffer<ObservationEvent>({ ...bufferOpts, maxItems: Math.min(opts.maxEventsPerStream ?? 50, 50) }),
      state: new RingBuffer<ObservationEvent>({ ...bufferOpts, maxItems: Math.min(opts.maxEventsPerStream ?? 50, 50) }),
      error: new RingBuffer<ObservationEvent>(bufferOpts),
    };
  }

  record(input: ObservationEventInput): ObservationEvent {
    const event = {
      ...input,
      id: input.id ?? `${this.id}-${++this.counter}`,
      ts: input.ts ?? this.now(),
    } as ObservationEvent;
    this.buffers[event.stream].push(event);
    return event;
  }

  events(opts: { stream?: ObservationStream; since?: number; until?: number } = {}): ObservationEvent[] {
    const streams = opts.stream ? [opts.stream] : Object.keys(this.buffers) as ObservationStream[];
    return streams
      .flatMap((stream) => this.buffers[stream].values({ since: opts.since, until: opts.until }))
      .sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id));
  }
}

export function createTraceId(now: number | (() => number) = Date.now): string {
  const ts = typeof now === 'function' ? now() : now;
  const rand = randomBytes(4).toString('hex');
  return `${new Date(ts).toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${rand}`;
}
