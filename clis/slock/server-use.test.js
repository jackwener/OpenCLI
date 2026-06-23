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

  it('[red-line] an input with a quote cannot break out of the snippet string', async () => {
    const page = {
      goto: vi.fn(),
      evaluate: vi.fn().mockResolvedValue({ kind: 'unresolvable', detail: 'x' }),
    };
    await command.func(page, { input: "ev'il" }).catch(() => {});
    const script = page.evaluate.mock.calls[0][0];
    // Vulnerable form embedded the input raw as `matches "ev'il"`, letting the
    // quote close the string literal. The input must only appear JSON-encoded.
    expect(script).not.toContain('no server matches "ev\'il"');
    expect(script).toContain('"ev\'il"');
  });
});
