/**
 * Subscription registry — persists who subscribes to what.
 * File: ~/.opencli/channel/subscriptions.json
 */

import { mkdirSync } from 'node:fs';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { Subscription } from './types.js';

const DEFAULT_PATH = join(homedir(), '.opencli', 'channel', 'subscriptions.json');

export class SubscriptionRegistry {
  private subs: Subscription[] = [];

  constructor(private readonly path: string = DEFAULT_PATH) {}

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.path, 'utf8');
      this.subs = JSON.parse(raw) as Subscription[];
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        this.subs = [];
        return;
      }
      throw e;
    }
  }

  async save(): Promise<void> {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, JSON.stringify(this.subs, null, 2), 'utf8');
    await rename(tmp, this.path);
  }

  add(origin: string, sink: string, sinkConfig: Record<string, unknown> = {}, intervalMs = 0): Subscription {
    // Check for existing subscription with same origin + sink
    const existing = this.subs.find(s => s.origin === origin && s.sink === sink);
    if (existing) return existing;

    const sub: Subscription = {
      id: randomUUID(),
      origin,
      sink,
      sinkConfig,
      intervalMs,
      createdAt: new Date().toISOString(),
    };
    this.subs.push(sub);
    return sub;
  }

  remove(origin: string): boolean {
    const before = this.subs.length;
    this.subs = this.subs.filter(s => s.origin !== origin);
    return this.subs.length < before;
  }

  removeById(id: string): boolean {
    const before = this.subs.length;
    this.subs = this.subs.filter(s => s.id !== id);
    return this.subs.length < before;
  }

  list(): Subscription[] {
    return [...this.subs];
  }

  /** Get all unique origins. */
  origins(): string[] {
    return [...new Set(this.subs.map(s => s.origin))];
  }

  /** Get all subscriptions for a given origin. */
  forOrigin(origin: string): Subscription[] {
    return this.subs.filter(s => s.origin === origin);
  }
}
