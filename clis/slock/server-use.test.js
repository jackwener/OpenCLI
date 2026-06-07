import { describe, it, expect, vi } from 'vitest';
import { ArgumentError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import './server-use.js';

describe('slock server-use', () => {
  const command = getRegistry().get('slock/server-use');

  it('writes localStorage when the slug resolves', async () => {
    const page = {
      goto: vi.fn(),
      evaluate: vi.fn().mockResolvedValue({
        kind: 'ok',
        rows: [{ slug: 'eng', id: 's1', name: 'Engineering' }],
        meta: { written: true, newSlug: 'eng' },
      }),
    };
    const rows = await command.func(page, { input: '#engineering' });
    expect(rows[0]).toMatchObject({ slug: 'eng', written: true });
  });

  it('atomicity: when slug is unknown, returns unresolvable and meta.written is false', async () => {
    const page = {
      goto: vi.fn(),
      evaluate: vi.fn().mockResolvedValue({ kind: 'unresolvable', detail: 'unknown slug "ops"' }),
    };
    await expect(command.func(page, { input: 'ops' })).rejects.toBeInstanceOf(ArgumentError);
  });

  it('rejects empty input before navigation', async () => {
    const page = { goto: vi.fn(), evaluate: vi.fn() };
    await expect(command.func(page, { input: '' })).rejects.toBeInstanceOf(ArgumentError);
    expect(page.goto).not.toHaveBeenCalled();
  });
});
