import { describe, it, expect, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './reaction-remove.js';

const UUID = '550e8400-e29b-41d4-a716-446655440000';
function makePage(result = { kind: 'ok', rows: { id: 'm1' } }) {
  return { goto: vi.fn(), evaluate: vi.fn().mockResolvedValue(result) };
}

describe('slock reaction-remove', () => {
  const command = getRegistry().get('slock/reaction-remove');

  it('short id is rejected before navigation', async () => {
    const page = makePage();
    await expect(command.func(page, { messageId: '8af3cbbb', emoji: '👍' }))
      .rejects.toThrow(/NOT accepted/);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('full UUID + emoji DELETEs /messages/:id/reactions and returns removed', async () => {
    const page = makePage();
    const rows = await command.func(page, { messageId: UUID, emoji: '👍' });
    const script = page.evaluate.mock.calls[0][0];
    expect(script).toContain(`/api/messages/${UUID}/reactions`);
    expect(script).toContain('"DELETE"');
    expect(script).toContain('emoji'); // body is {emoji}
    expect(rows[0]).toMatchObject({ messageId: UUID, emoji: '👍', result: 'removed' });
  });
});
