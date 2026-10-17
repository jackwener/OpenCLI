import { describe, it, expect, vi } from 'vitest';
import { ArgumentError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import './bookmark-list.js';

describe('slock bookmark-list', () => {
  const command = getRegistry().get('slock/bookmark-list');

  it('rejects invalid pagination before navigation', async () => {
    const page = {
      goto: vi.fn(),
      evaluate: vi.fn().mockResolvedValue({ kind: 'ok', rows: [] }),
    };
    await expect(command.func(page, { limit: 0 })).rejects.toBeInstanceOf(ArgumentError);
    await expect(command.func(page, { offset: -1 })).rejects.toBeInstanceOf(ArgumentError);
    expect(page.goto).not.toHaveBeenCalled();
  });

  // F3-b drift: real shape is { saved: [...], hasMore }. If a future refactor
  // strips data.saved out of the unwrap chain, the list silently returns [].

});
