import { describe, it, expect, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './whoami.js';

function makePage(authMe, status = 200) {
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(
      status === 200 ? { kind: 'ok', rows: authMe } : { kind: 'auth', detail: `/auth/me ${status}` },
    ),
  };
}

describe('slock whoami', () => {
  const command = getRegistry().get('slock/whoami');

  it('returns a normalized identity object from /auth/me on 200', async () => {
    const page = makePage({ id: 'u1', name: 'Alice', email: 'a@b.c' });
    const identity = await command.func(page, {});
    expect(identity).toEqual({ logged_in: true, site: 'slock', id: 'u1', name: 'Alice', email: 'a@b.c' });
    expect(page.goto).toHaveBeenCalled();
  });
});
