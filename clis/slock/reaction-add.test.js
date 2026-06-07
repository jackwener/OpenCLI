import { describe, it, expect, vi } from 'vitest';
import { ArgumentError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import './reaction-add.js';

const UUID = '550e8400-e29b-41d4-a716-446655440000';
function makePage(result = { kind: 'ok', rows: { id: 'm1' } }) {
  return { goto: vi.fn(), evaluate: vi.fn().mockResolvedValue(result) };
}

describe('slock reaction-add', () => {
  const command = getRegistry().get('slock/reaction-add');

  it('short id is rejected before navigation', async () => {
    const page = makePage();
    await expect(command.func(page, { messageId: '8af3cbbb', emoji: '👍' }))
      .rejects.toThrow(/NOT accepted/);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('missing emoji throws ArgumentError before navigation', async () => {
    const page = makePage();
    await expect(command.func(page, { messageId: UUID, emoji: '  ' }))
      .rejects.toBeInstanceOf(ArgumentError);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('full UUID + emoji POSTs to /messages/:id/reactions and returns added', async () => {
    const page = makePage();
    const rows = await command.func(page, { messageId: UUID, emoji: '👍' });
    expect(page.evaluate.mock.calls[0][0]).toContain(`/api/messages/${UUID}/reactions`);
    expect(rows[0]).toMatchObject({ messageId: UUID, emoji: '👍', result: 'added' });
  });
});
