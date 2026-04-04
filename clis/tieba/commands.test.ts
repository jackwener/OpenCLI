import { describe, expect, it } from 'vitest';
import { Strategy, getRegistry } from '../../src/registry.js';
import './hot.js';
import './posts.js';
import './read.js';
import './search.js';

describe('tieba commands', () => {
  it('registers all tieba commands as TypeScript adapters', () => {
    const hot = getRegistry().get('tieba/hot');
    const posts = getRegistry().get('tieba/posts');
    const search = getRegistry().get('tieba/search');
    const read = getRegistry().get('tieba/read');

    expect(hot).toBeDefined();
    expect(posts).toBeDefined();
    expect(search).toBeDefined();
    expect(read).toBeDefined();
    expect(typeof hot?.func).toBe('function');
    expect(typeof posts?.func).toBe('function');
    expect(typeof search?.func).toBe('function');
    expect(typeof read?.func).toBe('function');
  });

  it('keeps the intended browser strategies', () => {
    const hot = getRegistry().get('tieba/hot');
    const posts = getRegistry().get('tieba/posts');
    const search = getRegistry().get('tieba/search');
    const read = getRegistry().get('tieba/read');

    expect(hot?.strategy).toBe(Strategy.PUBLIC);
    expect(posts?.strategy).toBe(Strategy.COOKIE);
    expect(search?.strategy).toBe(Strategy.COOKIE);
    expect(read?.strategy).toBe(Strategy.COOKIE);
    expect(hot?.browser).toBe(true);
    expect(posts?.browser).toBe(true);
    expect(search?.browser).toBe(true);
    expect(read?.browser).toBe(true);
  });

  it('keeps the public limit contract at 20 items for list commands', () => {
    const hot = getRegistry().get('tieba/hot');
    const posts = getRegistry().get('tieba/posts');
    const search = getRegistry().get('tieba/search');

    expect(hot?.args.find((arg) => arg.name === 'limit')?.default).toBe(20);
    expect(posts?.args.find((arg) => arg.name === 'limit')?.default).toBe(20);
    expect(search?.args.find((arg) => arg.name === 'limit')?.default).toBe(20);
  });

  it('rejects tieba read results when navigation lands on the wrong page number', async () => {
    const read = getRegistry().get('tieba/read');
    expect(read).toBeDefined();
    expect(typeof read?.func).toBe('function');
    const run = read?.func;
    if (!run) throw new Error('tieba/read did not register a handler');
    const page = {
      goto: async () => undefined,
      evaluate: async () => ({
        pageMeta: {
          pathname: '/p/10163164720',
          pn: '1',
        },
        mainPost: {
          title: '测试帖子',
          author: '作者',
          contentText: '正文',
          structuredText: '',
          visibleTime: '2026-03-29 12:00',
          structuredTime: 0,
          hasMedia: false,
        },
        replies: [],
      }),
    };

    await expect(run(page as never, {
      id: '10163164720',
      page: 2,
      limit: 5,
    })).rejects.toMatchObject({
      code: 'EMPTY_RESULT',
      hint: expect.stringMatching(/requested page/i),
    });
  });
});
