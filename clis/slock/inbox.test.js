import { describe, it, expect, vi } from 'vitest';
import { ArgumentError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import './inbox.js';

function makePage(result) {
  return { goto: vi.fn(), evaluate: vi.fn().mockResolvedValue(result) };
}

describe('slock inbox', () => {
  const command = getRegistry().get('slock/inbox');

  it('rejects invalid pagination before navigation', async () => {
    const page = makePage({ kind: 'ok', rows: { items: [] } });
    await expect(command.func(page, { limit: 0 })).rejects.toBeInstanceOf(ArgumentError);
    await expect(command.func(page, { limit: 101 })).rejects.toBeInstanceOf(ArgumentError);
    await expect(command.func(page, { offset: -1 })).rejects.toBeInstanceOf(ArgumentError);
    expect(page.goto).not.toHaveBeenCalled();
  });

});
