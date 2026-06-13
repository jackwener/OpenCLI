import { describe, it, expect, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './server-list.js';

describe('slock server-list', () => {
  const command = getRegistry().get('slock/server-list');

  it('marks the active server based on localStorage slug', async () => {
    const page = {
      goto: vi.fn(),
      evaluate: vi.fn().mockResolvedValue({
        kind: 'ok',
        rows: [
          { id: 's1', slug: 'eng', name: 'Engineering' },
          { id: 's2', slug: 'design', name: 'Design' },
        ],
        meta: { activeSlug: 'design' },
      }),
    };
    const rows = await command.func(page, {});
    expect(rows.find((r) => r.slug === 'design').active).toBe(true);
    expect(rows.find((r) => r.slug === 'eng').active).toBe(false);
  });
});
