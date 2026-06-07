import { describe, it, expect, vi } from 'vitest';
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
    expect(page.evaluate.mock.calls[0][0]).toContain('limit=10');
    expect(page.evaluate.mock.calls[0][0]).toContain('offset=20');
    expect(rows[0]).toMatchObject({ id: 'b1', messageId: 'm1' });
  });
});
