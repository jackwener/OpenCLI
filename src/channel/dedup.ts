/**
 * In-memory ring-buffer dedup.
 * Keeps last N event IDs to prevent re-delivery.
 */

export class Dedup {
  private readonly ids: string[] = [];
  private readonly seen = new Set<string>();
  private readonly maxSize: number;

  constructor(maxSize = 10_000) {
    this.maxSize = maxSize;
  }

  isDuplicate(id: string): boolean {
    return this.seen.has(id);
  }

  add(id: string): void {
    if (this.seen.has(id)) return;
    this.ids.push(id);
    this.seen.add(id);
    if (this.ids.length > this.maxSize) {
      const oldest = this.ids.shift();
      if (oldest !== undefined) this.seen.delete(oldest);
    }
  }
}
