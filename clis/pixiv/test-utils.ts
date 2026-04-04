import { vi } from 'vitest';
import type { IPage } from '../../src/types.js';

/**
 * Create a minimal page mock with only the methods commonly used by Pixiv adapters.
 *
 * Since all TS adapters now go through `pixivFetch` which calls `page.evaluate`,
 * the evaluate results should match the raw Pixiv Ajax response format:
 * - Success: `{ body: ... }` (pixivFetch returns the `body` field)
 * - HTTP error: `{ __httpError: <status> }` (pixivFetch detects and throws)
 *
 * Additional methods can be overridden via the overrides parameter.
 */
export function createPageMock(
  evaluateResults: any[],
  overrides?: Partial<IPage>,
): IPage {
  const evaluate = vi.fn();
  for (const result of evaluateResults) {
    evaluate.mockResolvedValueOnce(result);
  }

  return {
    goto: vi.fn().mockResolvedValue(undefined),
    evaluate,
    getCookies: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as IPage;
}
