import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';

import './favorites.js';

function makePage(evaluateResults = []) {
  const queue = [...evaluateResults];
  const evaluate = vi.fn(async (script) => {
    if (String(script).includes('window.scrollBy')) return undefined;
    return queue.length ? queue.shift() : [];
  });

  return {
    goto: vi.fn().mockResolvedValue(undefined),
    wait: vi.fn().mockResolvedValue(undefined),
    evaluate,
  };
}

describe('weibo favorites command', () => {
  const getCommand = () => getRegistry().get('weibo/favorites');

  it('deduplicates repeated cards and applies the requested limit', async () => {
    const command = getCommand();
    const rawCard = {
      text: '作者A\n内容A',
      url: 'https://weibo.com/123/AbCd1',
    };
    const page = makePage([
      '123456',
      [
        rawCard,
        rawCard,
        { text: '作者B\n内容B', url: 'https://weibo.com/123/AbCd2' },
      ],
    ]);

    const result = await command.func(page, { limit: 1 });

    expect(result).toHaveLength(1);
    expect(result[0].author).toBe('作者A');
  });
});
