import { describe, expect, it, vi } from 'vitest';
import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { __test__ } from './auth.js';

function makePage({ cookies = [{ name: '_t', value: 'session' }], probe } = {}) {
  return {
    getCookies: vi.fn().mockResolvedValue(cookies),
    goto: vi.fn().mockResolvedValue(undefined),
    wait: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(probe),
  };
}

describe('linux-do auth identity probe', () => {
  it('uses Discourse session/current.json instead of the removed username meta tag', async () => {
    const page = makePage({
      probe: { ok: true, user_id: '42', username: 'alice', name: '' },
    });

    await expect(__test__.verifyLinuxDoIdentity(page)).resolves.toEqual({
      user_id: '42',
      username: 'alice',
      name: '',
    });

    const script = page.evaluate.mock.calls[0][0];
    expect(script).toContain('/session/current.json');
    expect(script).toContain('current_user');
    expect(script).not.toContain('current-user-username');
    expect(script).not.toContain("fetch('/u/'");
  });

  it('fails before navigation when the Linux.do session cookie is missing', async () => {
    const page = makePage({ cookies: [] });

    await expect(__test__.verifyLinuxDoIdentity(page)).rejects.toBeInstanceOf(AuthRequiredError);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it.each([
    [{ kind: 'auth', detail: 'anonymous' }, AuthRequiredError],
    [{ kind: 'http', httpStatus: 500 }, CommandExecutionError],
    [{ kind: 'exception', detail: 'boom' }, CommandExecutionError],
    [{ ok: true, username: 'alice', name: '' }, CommandExecutionError],
  ])('maps malformed and failed probes to typed errors', async (probe, errorType) => {
    const page = makePage({ probe });
    await expect(__test__.verifyLinuxDoIdentity(page)).rejects.toBeInstanceOf(errorType);
  });
});
