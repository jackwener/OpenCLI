export interface RingBufferOptions {
  maxAgeMs?: number;
  maxItems?: number;
  now?: () => number;
}

export class RingBuffer<T extends { ts: number }> {
  private readonly maxAgeMs: number;
  private readonly maxItems: number;
  private readonly now: () => number;
  private items: T[] = [];

  constructor(opts: RingBufferOptions = {}) {
    this.maxAgeMs = opts.maxAgeMs ?? 120_000;
    this.maxItems = opts.maxItems ?? 1_000;
    this.now = opts.now ?? Date.now;
  }

  push(item: T): void {
    this.items.push(item);
    this.prune();
  }

  values(opts: { since?: number; until?: number } = {}): T[] {
    this.prune();
    return this.items.filter((item) => {
      if (opts.since !== undefined && item.ts < opts.since) return false;
      if (opts.until !== undefined && item.ts > opts.until) return false;
      return true;
    });
  }

  clear(): void {
    this.items = [];
  }

  get size(): number {
    this.prune();
    return this.items.length;
  }

  private prune(): void {
    const minTs = this.now() - this.maxAgeMs;
    if (this.items.length > this.maxItems) {
      this.items = this.items.slice(this.items.length - this.maxItems);
    }
    if (this.maxAgeMs > 0) {
      const firstKept = this.items.findIndex((item) => item.ts >= minTs);
      if (firstKept > 0) this.items = this.items.slice(firstKept);
      else if (firstKept === -1) this.items = [];
    }
  }
}
