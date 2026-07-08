import { describe, it, expect, vi } from 'vitest';
import { ArgumentError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import './bookmark-remove.js';

function makePage(result = { kind: 'ok', rows: [{ removed: true }] }) {
  return { goto: vi.fn(), evaluate: vi.fn().mockResolvedValue(result) };
}

describe('slock bookmark-remove', () => {
  const command = getRegistry().get('slock/bookmark-remove');

  it('short id rejected before navigation', async () => {
    const page = makePage();
    await expect(command.func(page, { messageId: '8af3cbbb' })).rejects.toBeInstanceOf(ArgumentError);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('404 is treated as idempotent success (already removed)', async () => {
    const page = makePage({ kind: 'http', status: 404, where: '/channels/saved/:id' });
    const rows = await command.func(page, { messageId: '550e8400-e29b-41d4-a716-446655440000' });
    expect(rows[0]).toMatchObject({ removed: true, note: 'idempotent (already absent)' });
  });
});
