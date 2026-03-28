import { describe, expect, it, vi } from 'vitest';
import type { IPage } from '../../types.js';
import { getRegistry } from '../../registry.js';
import { parseCreatorNoteIdsFromHtml, parseCreatorNotesText } from './creator-notes.js';
import './creator-notes.js';

function createPageMock(evaluateResult: any, interceptedRequests: any[] = []): IPage {
  const evaluate = Array.isArray(evaluateResult)
    ? vi.fn()
        .mockResolvedValueOnce(evaluateResult[0])
        .mockResolvedValue(evaluateResult[evaluateResult.length - 1])
    : vi.fn().mockResolvedValue(evaluateResult);

  const getInterceptedRequests = Array.isArray(interceptedRequests)
    ? vi.fn().mockResolvedValue(interceptedRequests)
    : vi.fn().mockResolvedValue([]);

  return {
    goto: vi.fn().mockResolvedValue(undefined),
    evaluate,
    snapshot: vi.fn().mockResolvedValue(undefined),
    click: vi.fn().mockResolvedValue(undefined),
    typeText: vi.fn().mockResolvedValue(undefined),
    pressKey: vi.fn().mockResolvedValue(undefined),
    scrollTo: vi.fn().mockResolvedValue(undefined),
    getFormState: vi.fn().mockResolvedValue({ forms: [], orphanFields: [] }),
    wait: vi.fn().mockResolvedValue(undefined),
    tabs: vi.fn().mockResolvedValue([]),
    closeTab: vi.fn().mockResolvedValue(undefined),
    newTab: vi.fn().mockResolvedValue(undefined),
    selectTab: vi.fn().mockResolvedValue(undefined),
    networkRequests: vi.fn().mockResolvedValue([]),
    consoleMessages: vi.fn().mockResolvedValue([]),
    scroll: vi.fn().mockResolvedValue(undefined),
    autoScroll: vi.fn().mockResolvedValue(undefined),
    installInterceptor: vi.fn().mockResolvedValue(undefined),
    getInterceptedRequests,
    getCookies: vi.fn().mockResolvedValue([]),
    screenshot: vi.fn().mockResolvedValue(''),
    waitForCapture: vi.fn().mockResolvedValue(undefined),
  };
}

describe('xiaohongshu creator-notes', () => {
  it('parses creator note text blocks into rows', () => {
    const bodyText = `笔记管理
全部笔记(366)
已发布
神雕侠侣战力金字塔
发布于 2025年12月04日 19:45
148208
324
2279
465
32
权限设置
取消置顶
编辑
删除
仅自己可见
终于等到了！！！
发布于 2026年03月18日 12:39
10
0
0
0
0
权限设置`;

    expect(parseCreatorNotesText(bodyText)).toEqual([
      {
        id: '',
        title: '神雕侠侣战力金字塔',
        date: '2025年12月04日 19:45',
        views: 148208,
        likes: 2279,
        collects: 465,
        comments: 324,
        url: '',
      },
      {
        id: '',
        title: '终于等到了！！！',
        date: '2026年03月18日 12:39',
        views: 10,
        likes: 0,
        collects: 0,
        comments: 0,
        url: '',
      },
    ]);
  });

  it('reads body text and returns ranked rows', async () => {
    const cmd = getRegistry().get('xiaohongshu/creator-notes');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([
      undefined,
      {
        text: `示例笔记
发布于 2026年03月19日 12:00
10
2
3
4
5
权限设置`,
        html: '&quot;noteId&quot;:&quot;69ba940500000000200384db&quot;',
      },
    ]);

    const result = await cmd!.func!(page, { limit: 1 });

    expect((page.evaluate as any).mock.calls.at(-1)?.[0]).toBe('() => ({ text: document.body.innerText, html: document.body.innerHTML })');
    expect(result).toEqual([
      {
        rank: 1,
        id: '69ba940500000000200384db',
        title: '示例笔记',
        date: '2026年03月19日 12:00',
        views: 10,
        likes: 3,
        collects: 4,
        comments: 2,
        url: 'https://creator.xiaohongshu.com/statistics/note-detail?noteId=69ba940500000000200384db',
      },
    ]);
  });

  it('prefers note card dom data when the analyze api is unavailable', async () => {
    const cmd = getRegistry().get('xiaohongshu/creator-notes');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([
      undefined,
      [
        {
          id: '693155fc000000000d03b42c',
          title: '神雕侠侣战力金字塔',
          date: '2025年12月04日 19:45',
          metrics: [148284, 319, 2280, 466, 33],
        },
      ],
    ]);

    const result = await cmd!.func!(page, { limit: 1 });

    expect(result).toEqual([
      {
        rank: 1,
        id: '693155fc000000000d03b42c',
        title: '神雕侠侣战力金字塔',
        date: '2025年12月04日 19:45',
        views: 148284,
        likes: 2280,
        collects: 466,
        comments: 319,
        url: 'https://creator.xiaohongshu.com/statistics/note-detail?noteId=693155fc000000000d03b42c',
      },
    ]);
  });

  it('prefers the creator analyze API and preserves note ids', async () => {
    const cmd = getRegistry().get('xiaohongshu/creator-notes');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock(undefined, [{
      data: {
        note_infos: [
          {
            id: '69ba940500000000200384db',
            title: '一张图讲清 诡秘之主·耕种者途径',
            post_time: new Date('2026-03-18T20:01:00+08:00').getTime(),
            read_count: 521,
            like_count: 18,
            fav_count: 10,
            comment_count: 7,
          },
        ],
      },
    }]);

    const result = await cmd!.func!(page, { limit: 1 });

    expect((page.installInterceptor as any).mock.calls[0][0]).toContain('/api/galaxy/creator/datacenter/note/analyze/list');
    expect(result).toEqual([
      {
        rank: 1,
        id: '69ba940500000000200384db',
        title: '一张图讲清 诡秘之主·耕种者途径',
        date: '2026年03月18日 20:01',
        views: 521,
        likes: 18,
        collects: 10,
        comments: 7,
        url: 'https://creator.xiaohongshu.com/statistics/note-detail?noteId=69ba940500000000200384db',
      },
    ]);
  });

  it('extracts note ids from creator note-manager html', () => {
    const html = `
      <div>&quot;noteId&quot;:&quot;69ba940500000000200384db&quot;</div>
      <div>&quot;noteId&quot;:&quot;69ba2c98000000001a026e0f&quot;</div>
      <div>&quot;noteId&quot;:&quot;69ba940500000000200384db&quot;</div>
    `;

    expect(parseCreatorNoteIdsFromHtml(html)).toEqual([
      '69ba940500000000200384db',
      '69ba2c98000000001a026e0f',
    ]);
  });
});
