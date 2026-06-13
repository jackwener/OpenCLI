import { describe, it, expect, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './channel-list.js';

describe('[anti-drift] X-Server-Id does not leak across commands', () => {
  it('two channel-list calls with different --server use distinct sids in their snippets', async () => {
    const cmd = getRegistry().get('slock/channel-list');
    const page = {
      goto: vi.fn(),
      evaluate: vi.fn().mockResolvedValue({ kind: 'ok', rows: [] }),
    };
    await cmd.func(page, { server: 'eng' });
    await cmd.func(page, { server: 'design' });
    const s1 = page.evaluate.mock.calls[0][0];
    const s2 = page.evaluate.mock.calls[1][0];
    expect(s1).toContain('"eng"');
    expect(s1).not.toContain('"design"');
    expect(s2).toContain('"design"');
    expect(s2).not.toContain('"eng"');
  });
});
