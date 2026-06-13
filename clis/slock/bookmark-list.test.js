import { describe, it, expect, vi } from 'vitest';
import { ArgumentError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import './bookmark-list.js';

describe('slock bookmark-list', () => {
  const command = getRegistry().get('slock/bookmark-list');

  it('passes --limit and --offset through to the snippet query string', async () => {
    const page = {
      goto: vi.fn(),
      evaluate: vi.fn().mockResolvedValue({ kind: 'ok', rows: [{ id: 'b1', messageId: 'm1', content: 'hi' }] }),
    };
    const rows = await command.func(page, { limit: 10, offset: 20 });
    expect(page.evaluate.mock.calls[0][0]).toContain("limit=' + encodeURIComponent(10)");
    expect(page.evaluate.mock.calls[0][0]).toContain("offset=' + encodeURIComponent(20)");
    expect(rows[0]).toMatchObject({ id: 'b1', messageId: 'm1' });
  });

  it('rejects invalid pagination before navigation', async () => {
    const page = {
      goto: vi.fn(),
      evaluate: vi.fn().mockResolvedValue({ kind: 'ok', rows: [] }),
    };
    await expect(command.func(page, { limit: 0 })).rejects.toBeInstanceOf(ArgumentError);
    await expect(command.func(page, { offset: -1 })).rejects.toBeInstanceOf(ArgumentError);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('[anti-drift] non-array rows throws instead of silently returning empty', async () => {
    const page = { goto: vi.fn(), evaluate: vi.fn().mockResolvedValue({ kind: 'ok', rows: { wrong: 'shape' } }) };
    await expect(command.func(page, {})).rejects.toThrow(/expected array/);
  });

  // F3-b drift: real shape is { saved: [...], hasMore }. If a future refactor
  // strips data.saved out of the unwrap chain, the list silently returns [].
  it('[F3-b drift] in-page snippet unwraps data.saved FIRST in the fallback chain', async () => {
    const page = {
      goto: vi.fn(),
      evaluate: vi.fn().mockResolvedValue({ kind: 'ok', rows: [] }),
    };
    await command.func(page, {});
    const snippet = page.evaluate.mock.calls[0][0];
    // saved before bookmarks before data — order matters for forward-compat.
    expect(snippet).toMatch(/data\.saved\s*\|\|\s*data\.bookmarks\s*\|\|\s*data\.data/);
  });
});
