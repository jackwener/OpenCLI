import { describe, it, expect, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './bookmark-add.js';

function makePage(result = { kind: 'ok', rows: [{ id: 'b1' }] }) {
  return { goto: vi.fn(), evaluate: vi.fn().mockResolvedValue(result) };
}

describe('slock bookmark-add', () => {
  const command = getRegistry().get('slock/bookmark-add');

  it('short id is rejected with a hint mentioning "NOT accepted", before navigation', async () => {
    const page = makePage();
    await expect(command.func(page, { messageId: '8af3cbbb' }))
      .rejects.toThrow(/NOT accepted/);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('full UUID POSTs to /channels/saved and returns the bookmark id', async () => {
    const page = makePage();
    const rows = await command.func(page, { messageId: '550e8400-e29b-41d4-a716-446655440000' });
    expect(rows[0]).toMatchObject({ messageId: '550e8400-e29b-41d4-a716-446655440000' });
    expect(page.evaluate.mock.calls[0][0]).toContain('/channels/saved');
  });
});
