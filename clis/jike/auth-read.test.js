import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { requireJikeIdentity } from './utils.js';
import './auth.js';
import './feed.js';
import './notifications.js';
import './search.js';

function makePage(...evaluateResults) {
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    wait: vi.fn().mockResolvedValue(undefined),
    autoScroll: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockImplementation(async () => evaluateResults.shift()),
  };
}

const identity = {
  ok: true,
  user_id: 'user-1',
  screen_name: 'Alice',
  username: 'alice',
};

describe('Jike identity guard', () => {
  it('preserves the whoami identity contract', async () => {
    const page = makePage(identity);

    await expect(getRegistry().get('jike/whoami').func(page, {})).resolves.toEqual({
      logged_in: true,
      site: 'jike',
      user_id: 'user-1',
      screen_name: 'Alice',
      username: 'alice',
    });
    expect(page.goto).toHaveBeenCalledWith('https://web.okjike.com/');
  });

  it('keeps login polling after a transient non-auth probe failure', async () => {
    const page = makePage(
      { kind: 'auth', detail: 'anonymous' },
      { kind: 'http', httpStatus: 503 },
      identity,
    );

    await expect(getRegistry().get('jike/login').func(page, { timeout: 5 })).resolves.toEqual({
      status: 'login_complete',
      logged_in: true,
      site: 'jike',
      user_id: 'user-1',
      screen_name: 'Alice',
      username: 'alice',
    });
    expect(page.goto).toHaveBeenNthCalledWith(1, 'https://web.okjike.com/');
    expect(page.goto).toHaveBeenNthCalledWith(2, 'https://web.okjike.com/login');
    expect(page.evaluate).toHaveBeenCalledTimes(3);
  });

  it('classifies missing or rejected credentials as AuthRequiredError', async () => {
    await expect(requireJikeIdentity(makePage({
      kind: 'auth',
      detail: 'Jike JK_ACCESS_TOKEN missing from localStorage (anonymous)',
    }))).rejects.toBeInstanceOf(AuthRequiredError);
  });

  it.each([
    [{ kind: 'http', httpStatus: 503 }],
    [{ kind: 'exception', detail: 'network failed' }],
    [{ unexpected: true }],
  ])('classifies non-auth probe failure as CommandExecutionError', async (probe) => {
    await expect(requireJikeIdentity(makePage(probe))).rejects.toBeInstanceOf(CommandExecutionError);
  });

  it.each([
    ['jike/feed', {}, 'https://web.okjike.com'],
    ['jike/search', { query: 'OpenCLI' }, 'https://web.okjike.com/search?q=OpenCLI'],
    ['jike/notifications', {}, 'https://web.okjike.com/notification'],
  ])('prevents %s from silently returning an empty anonymous result', async (commandName, args, expectedUrl) => {
    const page = makePage({
      kind: 'auth',
      detail: 'Jike JK_ACCESS_TOKEN missing from localStorage (anonymous)',
    });

    await expect(getRegistry().get(commandName).func(page, args)).rejects.toBeInstanceOf(AuthRequiredError);
    expect(page.goto).toHaveBeenCalledWith(expectedUrl);
    expect(page.evaluate).toHaveBeenCalledTimes(1);
  });

  it('continues feed extraction after a successful identity probe', async () => {
    const rows = [{ id: 'post-1', author: 'Alice', content: 'hello', likes: 2, comments: 1, time: 'now', url: 'https://web.okjike.com/originalPost/post-1' }];
    const page = makePage(identity, rows);

    await expect(getRegistry().get('jike/feed').func(page, { limit: 1 })).resolves.toEqual(rows);
    expect(page.evaluate).toHaveBeenCalledTimes(2);
  });

  it('continues notification extraction after a successful identity probe', async () => {
    const page = makePage(identity, {
      kind: 'response',
      status: 200,
      body: {
        data: [{
          id: 'notification-1',
          type: 'LIKE_PERSONAL_UPDATE',
          createdAt: 'now',
          actionItem: { users: [{ screenName: 'Bob' }], content: 'hello\nworld' },
        }],
      },
    });

    await expect(getRegistry().get('jike/notifications').func(page, { limit: 1 })).resolves.toEqual([{
      type: '赞了你的动态',
      user: 'Bob',
      content: 'hello world',
      time: 'now',
    }]);
    expect(page.evaluate).toHaveBeenCalledTimes(2);
  });
});
