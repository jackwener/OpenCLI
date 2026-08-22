import { describe, expect, it, vi } from 'vitest';
import { __test__ } from './auth.js';

describe('boss auth identity probe', () => {
  it('navigates to the current geek jobs route instead of the retired reload-loop route', async () => {
    const page = {
      getCookies: vi.fn().mockResolvedValue([{ name: 'wt2' }]),
      goto: vi.fn().mockResolvedValue(undefined),
      wait: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue({ ok: true, user_type: 'geek' }),
    };

    await expect(__test__.verifyBossIdentity(page)).resolves.toEqual({ user_type: 'geek' });
    expect(page.goto).toHaveBeenCalledOnce();
    expect(page.goto).toHaveBeenCalledWith('https://www.zhipin.com/web/geek/jobs');
    expect(__test__.BOSS_GEEK_JOBS_URL).not.toContain('job-recommend');
  });
});
