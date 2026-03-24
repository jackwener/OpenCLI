/**
 * Bounded event queue with dedup window.
 *
 * - Deduplicates events by ID (same event won't be pushed twice)
 * - Bounded size: discards oldest when full (silent)
 * - Dedup window: remembers recently seen IDs even after drain
 */

import type { ChannelEvent } from './types.js'

export interface QueueOptions {
  /** Max events buffered before oldest are discarded. Default: 200 */
  maxSize?: number
  /** Number of recent event IDs kept for dedup after drain. Default: 500 */
  dedupWindowSize?: number
}

export class EventQueue {
  private readonly events: ChannelEvent[] = []
  private readonly seenIds: string[] = []
  private readonly seenSet = new Set<string>()
  private readonly maxSize: number
  private readonly dedupWindowSize: number

  constructor(opts: QueueOptions = {}) {
    this.maxSize = opts.maxSize ?? 200
    this.dedupWindowSize = opts.dedupWindowSize ?? 500
  }

  /** Push an event. Returns false if it was a duplicate. */
  push(event: ChannelEvent): boolean {
    if (this.seenSet.has(event.id)) return false

    this.trackId(event.id)
    this.events.push(event)

    // Discard oldest if over capacity
    while (this.events.length > this.maxSize) {
      this.events.shift()
    }

    return true
  }

  /** Drain all pending events (removes them from the queue). */
  drain(): ChannelEvent[] {
    return this.events.splice(0)
  }

  /** Number of events waiting to be drained. */
  get pending(): number {
    return this.events.length
  }

  private trackId(id: string): void {
    this.seenIds.push(id)
    this.seenSet.add(id)

    while (this.seenIds.length > this.dedupWindowSize) {
      const old = this.seenIds.shift()!
      this.seenSet.delete(old)
    }
  }
}
