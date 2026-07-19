import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './user.js';

function getUserEvaluateJs() {
  const cmd = getRegistry().get('instagram/user');
  const evalStep = cmd.pipeline.find((s) => s.evaluate);
  return evalStep.evaluate;
}

async function runUserEvaluate(fetchFn, args = { username: 'sleepcycleapp', limit: 2 }) {
  const js = getUserEvaluateJs()
    .replace('${{ args.username | json }}', JSON.stringify(args.username))
    .replace('${{ args.limit }}', String(args.limit));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchFn;
  try {
    return await eval(js);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

describe('instagram/user feed fetch', () => {
  it('fetches recent posts directly by username', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          {
            caption: { text: 'First post\nwith newline' },
            like_count: 12,
            comment_count: 3,
            media_type: 1,
            taken_at: 1784451600,
          },
          {
            caption: { text: 'Second post' },
            like_count: 4,
            comment_count: 1,
            media_type: 2,
          },
        ],
      }),
    });

    const result = await runUserEvaluate(fetchFn, { username: 'sleep cycle/app', limit: 2 });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0][0]).toBe('https://www.instagram.com/api/v1/feed/user/sleep%20cycle%2Fapp/username/?count=2');
    expect(fetchFn.mock.calls[0][1]).toMatchObject({
      credentials: 'include',
      headers: { 'X-IG-App-ID': '936619743392459' },
    });
    expect(fetchFn.mock.calls[0][0]).not.toContain('web_profile_info');
    expect(result).toEqual([
      { index: 1, caption: 'First post with newline', likes: 12, comments: 3, type: 'photo', date: expect.any(String) },
      { index: 2, caption: 'Second post', likes: 4, comments: 1, type: 'video', date: '' },
    ]);
  });

  it('keeps the login-oriented error for failed feed requests', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 400 });
    await expect(runUserEvaluate(fetchFn)).rejects.toThrow('HTTP 400 - make sure you are logged in to Instagram');
  });
});
