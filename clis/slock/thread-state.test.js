import { describe, it, expect, vi } from 'vitest';
import { ArgumentError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import './thread-unfollow.js';
import './thread-done.js';
import './thread-undone.js';

const UUID = '550e8400-e29b-41d4-a716-446655440000';
function makePage(result = { kind: 'ok', rows: { ok: true } }) {
  return { goto: vi.fn(), evaluate: vi.fn().mockResolvedValue(result) };
}

const CASES = [
  ['thread-unfollow', 'unfollow', 'unfollowed'],
  ['thread-done', 'done', 'done'],
  ['thread-undone', 'undone', 'undone'],
];

describe('slock thread-state factory', () => {
  for (const [name, verb, label] of CASES) {
    const command = getRegistry().get(`slock/${name}`);

    it(`${name}: non-UUID threadChannelId rejected before navigation`, async () => {
      const page = makePage();
      await expect(command.func(page, { threadChannelId: 'nope' })).rejects.toBeInstanceOf(ArgumentError);
      expect(page.goto).not.toHaveBeenCalled();
    });

    it(`${name}: POSTs /channels/threads/${verb} and returns "${label}"`, async () => {
      const page = makePage();
      const rows = await command.func(page, { threadChannelId: UUID });
      const script = page.evaluate.mock.calls[0][0];
      expect(script).toContain(`/channels/threads/${verb}`);
      expect(script).toContain('threadChannelId'); // body keyed by threadChannelId, not parentMessageId
      expect(rows[0]).toMatchObject({ threadChannelId: UUID, result: label });
    });
  }
});
