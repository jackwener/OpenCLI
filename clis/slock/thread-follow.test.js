import { describe, it, expect, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import './thread-follow.js';

const UUID = '550e8400-e29b-41d4-a716-446655440000';
function makePage(result = { kind: 'ok', rows: { ok: true, threadChannelId: 'th1' } }) {
  return { goto: vi.fn(), evaluate: vi.fn().mockResolvedValue(result) };
}

describe('slock thread-follow', () => {
  const command = getRegistry().get('slock/thread-follow');

  it('short parent id is rejected before navigation', async () => {
    const page = makePage();
    await expect(command.func(page, { parentMessageId: '8af3cbbb' })).rejects.toThrow(/NOT accepted/);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('POSTs /channels/threads/follow with parentMessageId and returns the thread id', async () => {
    const page = makePage();
    const rows = await command.func(page, { parentMessageId: UUID });
    const script = page.evaluate.mock.calls[0][0];
    expect(script).toContain('/channels/threads/follow');
    expect(script).toContain('parentMessageId'); // body keyed by parentMessageId, not threadChannelId
    expect(rows[0]).toMatchObject({ parentMessageId: UUID, threadChannelId: 'th1', result: 'followed' });
  });

  it('[postcondition] rejects a 2xx follow response without threadChannelId', async () => {
    const page = makePage({ kind: 'ok', rows: { ok: true } });
    await expect(command.func(page, { parentMessageId: UUID }))
      .rejects.toBeInstanceOf(CommandExecutionError);
  });
});
