/**
 * Shared utility functions used across the codebase.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import TurndownService from 'turndown';

/** Type guard: checks if a value is a non-null, non-array object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Simple async concurrency limiter. */
export async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i], i);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/** Pause for the given number of milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Save a base64-encoded string to a file, creating parent directories as needed. */
export async function saveBase64ToFile(base64: string, filePath: string): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(filePath, Buffer.from(base64, 'base64'));
}

export function createMarkdownConverter(configure?: (td: TurndownService) => void): TurndownService {
  const td = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  });

  td.addRule('linebreak', {
    filter: 'br',
    replacement: () => '\n',
  });

  if (configure) configure(td);
  return td;
}

export function htmlToMarkdown(value: string, configure?: (td: TurndownService) => void): string {
  return createMarkdownConverter(configure).turndown(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\n{4,}/g, '\n\n\n')
    .replace(/[ \t]+$/gm, '')
    .trim();
}
