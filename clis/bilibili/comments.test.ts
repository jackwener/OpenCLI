import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockApiGet } = vi.hoisted(() => ({
  mockApiGet: vi.fn(),
}));

vi.mock('./utils.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./utils.js')>()),
  apiGet: mockApiGet,
}));

import { getRegistry } from '../../src/registry.js';
import './comments.js';

describe('bilibili comments', () => {
  const command = getRegistry().get('bilibili/comments');

  beforeEach(() => {
    mockApiGet.mockReset();
  });

  it('resolves bvid to aid and fetches replies', async () => {
    mockApiGet
      .mockResolvedValueOnce({ data: { aid: 12345 } }) // view endpoint
      .mockResolvedValueOnce({
        data: {
          replies: [
            {
              member: { uname: 'Alice' },
              content: { message: 'Great video!' },
              like: 42,
              rcount: 3,
              ctime: 1700000000,
            },
          ],
        },
      });

    const result = await command!.func!({} as any, { bvid: 'BV1WtAGzYEBm', limit: 5 });

    expect(mockApiGet).toHaveBeenNthCalledWith(1, {}, '/x/web-interface/view', { params: { bvid: 'BV1WtAGzYEBm' } });
    expect(mockApiGet).toHaveBeenNthCalledWith(2, {}, '/x/v2/reply/main', {
      params: { oid: 12345, type: 1, mode: 3, ps: 5 },
      signed: true,
    });

    expect(result).toEqual([
      {
        rank: 1,
        author: 'Alice',
        text: 'Great video!',
        likes: 42,
        replies: 3,
        time: new Date(1700000000 * 1000).toISOString().slice(0, 16).replace('T', ' '),
      },
    ]);
  });

  it('throws when aid cannot be resolved', async () => {
    mockApiGet.mockResolvedValueOnce({ data: {} }); // no aid

    await expect(command!.func!({} as any, { bvid: 'BVinvalid123', limit: 5 })).rejects.toThrow(
      'Cannot resolve aid for bvid: BVinvalid123',
    );
  });

  it('returns empty array when replies is missing', async () => {
    mockApiGet
      .mockResolvedValueOnce({ data: { aid: 99 } })
      .mockResolvedValueOnce({ data: {} }); // no replies key

    const result = await command!.func!({} as any, { bvid: 'BV1xxx', limit: 5 });
    expect(result).toEqual([]);
  });

  it('caps limit at 50', async () => {
    mockApiGet
      .mockResolvedValueOnce({ data: { aid: 1 } })
      .mockResolvedValueOnce({ data: { replies: [] } });

    await command!.func!({} as any, { bvid: 'BV1xxx', limit: 999 });

    expect(mockApiGet).toHaveBeenNthCalledWith(2, {}, '/x/v2/reply/main', {
      params: { oid: 1, type: 1, mode: 3, ps: 50 },
      signed: true,
    });
  });

  it('collapses newlines in comment text', async () => {
    mockApiGet
      .mockResolvedValueOnce({ data: { aid: 1 } })
      .mockResolvedValueOnce({
        data: {
          replies: [
            { member: { uname: 'Bob' }, content: { message: 'line1\nline2\nline3' }, like: 0, rcount: 0, ctime: 0 },
          ],
        },
      });

    const result = (await command!.func!({} as any, { bvid: 'BV1xxx', limit: 5 })) as any[];
    expect(result[0].text).toBe('line1 line2 line3');
  });
});
