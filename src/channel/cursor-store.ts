/**
 * Cursor store — persists poll positions per origin.
 * File: ~/.opencli/channel/cursors.json
 */

import { mkdirSync } from 'node:fs';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

export interface CursorEntry {
  cursor: string;
  lastPoll: string;
  eventsDelivered: number;
}

const DEFAULT_PATH = join(homedir(), '.opencli', 'channel', 'cursors.json');

export class CursorStore {
  private entries = new Map<string, CursorEntry>();

  constructor(private readonly path: string = DEFAULT_PATH) {}

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.path, 'utf8');
      const parsed = JSON.parse(raw) as Record<string, CursorEntry>;
      this.entries = new Map(Object.entries(parsed));
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        this.entries = new Map();
        return;
      }
      throw e;
    }
  }

  private saving: Promise<void> | null = null;

  async save(): Promise<void> {
    // Serialize concurrent saves to avoid tmp file race condition
    if (this.saving) {
      await this.saving;
    }
    this.saving = this._doSave();
    await this.saving;
    this.saving = null;
  }

  private async _doSave(): Promise<void> {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.${process.pid}.tmp`;
    const data = JSON.stringify(Object.fromEntries(this.entries), null, 2);
    await writeFile(tmp, data, 'utf8');
    await rename(tmp, this.path);
  }

  get(origin: string): CursorEntry | undefined {
    return this.entries.get(origin);
  }

  set(origin: string, cursor: string, eventsDelivered: number): void {
    this.entries.set(origin, {
      cursor,
      lastPoll: new Date().toISOString(),
      eventsDelivered,
    });
  }

  getAll(): Map<string, CursorEntry> {
    return new Map(this.entries);
  }
}
