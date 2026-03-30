import { describe, expect, it } from 'vitest';
import {
  buildNotebooklmRpcBody,
  classifyNotebooklmPage,
  extractNotebooklmHistoryPreview,
  extractNotebooklmRpcResult,
  getNotebooklmPageState,
  normalizeNotebooklmTitle,
  parseNotebooklmHistoryThreadIdsResult,
  parseNotebooklmIdFromUrl,
  parseNotebooklmListResult,
  parseNotebooklmNoteListRawRows,
  parseNotebooklmNotebookDetailResult,
  parseNotebooklmSourceFulltextResult,
  parseNotebooklmSourceGuideResult,
  parseNotebooklmSourceListResult,
} from './utils.js';

describe('notebooklm utils', () => {
  it('parses notebook id from a notebook url', () => {
    expect(parseNotebooklmIdFromUrl('https://notebooklm.google.com/notebook/abc-123')).toBe('abc-123');
  });

  it('returns empty string when notebook id is absent', () => {
    expect(parseNotebooklmIdFromUrl('https://notebooklm.google.com/')).toBe('');
  });

  it('classifies notebook pages correctly', () => {
    expect(classifyNotebooklmPage('https://notebooklm.google.com/notebook/demo-id')).toBe('notebook');
    expect(classifyNotebooklmPage('https://notebooklm.google.com/')).toBe('home');
    expect(classifyNotebooklmPage('https://example.com/notebook/demo-id')).toBe('unknown');
  });

  it('normalizes notebook titles', () => {
    expect(normalizeNotebooklmTitle('  Demo   Notebook  ')).toBe('Demo Notebook');
    expect(normalizeNotebooklmTitle('', 'Untitled')).toBe('Untitled');
  });

  it('builds the notebooklm rpc request body with csrf token', () => {
    const body = buildNotebooklmRpcBody('wXbhsf', [null, 1, null, [2]], 'csrf123');
    expect(body).toContain('f.req=');
    expect(body).toContain('at=csrf123');
    expect(body.endsWith('&')).toBe(true);
    expect(decodeURIComponent(body)).toContain('"[null,1,null,[2]]"');
  });

  it('extracts notebooklm rpc payload from chunked batchexecute response', () => {
    const raw = ')]}\'\n107\n[["wrb.fr","wXbhsf","[[[\\"Notebook One\\",null,\\"nb1\\",null,null,[null,false,null,null,null,[1704067200]]]]]"]]';
    const result = extractNotebooklmRpcResult(raw, 'wXbhsf');
    expect(Array.isArray(result)).toBe(true);
    expect((result as unknown[])[0]).toBeDefined();
  });

  it('parses notebook rows from notebooklm rpc payload', () => {
    const rows = parseNotebooklmListResult([
      [
        ['Notebook One', null, 'nb1', null, null, [null, false, null, null, null, [1704067200]]],
      ],
    ]);

    expect(rows).toEqual([
      {
        id: 'nb1',
        title: 'Notebook One',
        url: 'https://notebooklm.google.com/notebook/nb1',
        source: 'rpc',
        is_owner: true,
        created_at: '2024-01-01T00:00:00.000Z',
      },
    ]);
  });

  it('parses notebook metadata from notebook detail rpc payload', () => {
    const notebook = parseNotebooklmNotebookDetailResult([
      'Browser Automation',
      [
        [
          [['src1']],
          'Pasted text',
          [null, 359, [1774872183, 855096000], ['doc1', [1774872183, 356519000]], 8, null, 1, null, null, null, null, null, null, null, [1774872185, 395271000]],
          [null, 2],
        ],
      ],
      'nb-demo',
      '🕸️',
      null,
      [1, false, true, null, null, [1774889558, 348721000], 1, false, [1774872161, 361922000], null, null, null, false, true, 1, false, null, true, 1],
    ]);

    expect(notebook).toEqual({
      id: 'nb-demo',
      title: 'Browser Automation',
      url: 'https://notebooklm.google.com/notebook/nb-demo',
      source: 'rpc',
      emoji: '🕸️',
      source_count: 1,
      is_owner: true,
      created_at: '2026-03-30T12:02:41.361Z',
      updated_at: '2026-03-30T16:52:38.348Z',
    });
  });

  it('parses notebook metadata when detail rpc wraps the payload in a singleton envelope', () => {
    const notebook = parseNotebooklmNotebookDetailResult([
      [
        'Browser Automation',
        [
          [
            [['src1']],
            'Pasted text',
            [null, 359, [1774872183, 855096000], ['doc1', [1774872183, 356519000]], 8, null, 1, null, null, null, null, null, null, null, [1774872185, 395271000]],
            [null, 2],
          ],
        ],
        'nb-demo',
        '🕸️',
        null,
        [1, false, true, null, null, [1774889558, 348721000], 1, false, [1774872161, 361922000], null, null, null, false, true, 1, false, null, true, 1],
      ],
    ]);

    expect(notebook).toEqual({
      id: 'nb-demo',
      title: 'Browser Automation',
      url: 'https://notebooklm.google.com/notebook/nb-demo',
      source: 'rpc',
      emoji: '🕸️',
      source_count: 1,
      is_owner: true,
      created_at: '2026-03-30T12:02:41.361Z',
      updated_at: '2026-03-30T16:52:38.348Z',
    });
  });

  it('parses sources from notebook detail rpc payload', () => {
    const rows = parseNotebooklmSourceListResult([
      'Browser Automation',
      [
        [
          [['src1']],
          'Pasted text',
          [null, 359, [1774872183, 855096000], ['doc1', [1774872183, 356519000]], 8, null, 1, null, null, null, null, null, null, null, [1774872185, 395271000]],
          [null, 2],
        ],
      ],
      'nb-demo',
      '🕸️',
      null,
      [1, false, true, null, null, [1774889558, 348721000], 1, false, [1774872161, 361922000], null, null, null, false, true, 1, false, null, true, 1],
    ]);

    expect(rows).toEqual([
      {
        id: 'src1',
        notebook_id: 'nb-demo',
        title: 'Pasted text',
        type: 'pasted-text',
        type_code: 8,
        size: 359,
        created_at: '2026-03-30T12:03:03.855Z',
        updated_at: '2026-03-30T12:03:05.395Z',
        url: 'https://notebooklm.google.com/notebook/nb-demo',
        source: 'rpc',
      },
    ]);
  });

  it('parses sources when detail rpc wraps the payload in a singleton envelope', () => {
    const rows = parseNotebooklmSourceListResult([
      [
        'Browser Automation',
        [
          [
            [['src1']],
            'Pasted text',
            [null, 359, [1774872183, 855096000], ['doc1', [1774872183, 356519000]], 8, null, 1, null, null, null, null, null, null, null, [1774872185, 395271000]],
            [null, 2],
          ],
        ],
        'nb-demo',
        '🕸️',
        null,
        [1, false, true, null, null, [1774889558, 348721000], 1, false, [1774872161, 361922000], null, null, null, false, true, 1, false, null, true, 1],
      ],
    ]);

    expect(rows).toEqual([
      {
        id: 'src1',
        notebook_id: 'nb-demo',
        title: 'Pasted text',
        type: 'pasted-text',
        type_code: 8,
        size: 359,
        created_at: '2026-03-30T12:03:03.855Z',
        updated_at: '2026-03-30T12:03:05.395Z',
        url: 'https://notebooklm.google.com/notebook/nb-demo',
        source: 'rpc',
      },
    ]);
  });

  it('parses sources when the source id container is only wrapped once', () => {
    const rows = parseNotebooklmSourceListResult([
      [
        'Browser Automation',
        [
          [
            ['src-live'],
            'Pasted text',
            [null, 359, [1774872183, 855096000], ['doc1', [1774872183, 356519000]], 8, null, 1, null, null, null, null, null, null, null, [1774872185, 395271000]],
            [null, 2],
          ],
        ],
        'nb-demo',
        '🕸️',
        null,
        [1, false, true, null, null, [1774889558, 348721000], 1, false, [1774872161, 361922000], null, null, null, false, true, 1, false, null, true, 1],
      ],
    ]);

    expect(rows).toEqual([
      {
        id: 'src-live',
        notebook_id: 'nb-demo',
        title: 'Pasted text',
        type: 'pasted-text',
        type_code: 8,
        size: 359,
        created_at: '2026-03-30T12:03:03.855Z',
        updated_at: '2026-03-30T12:03:05.395Z',
        url: 'https://notebooklm.google.com/notebook/nb-demo',
        source: 'rpc',
      },
    ]);
  });

  it('parses source type from metadata slot instead of the stale entry[3] envelope', () => {
    const rows = parseNotebooklmSourceListResult([
      [
        'Browser Automation',
        [
          [
            ['src-pdf'],
            'Manual.pdf',
            [null, 18940, [1774872183, 855096000], ['doc1', [1774872183, 356519000]], 3, null, 1, null, null, null, null, null, null, null, [1774872185, 395271000]],
            [null, 2],
          ],
          [
            ['src-web'],
            'Example Site',
            [null, 131, [1774872183, 855096000], ['doc2', [1774872183, 356519000]], 5, ['https://example.com'], 1, null, null, null, null, null, null, null, [1774872185, 395271000]],
            [null, 2],
          ],
          [
            ['src-yt'],
            'Video Source',
            [null, 11958, [1774872183, 855096000], ['doc3', [1774872183, 356519000]], 9, ['https://youtu.be/demo', 'demo', 'Uploader'], 1, null, null, null, null, null, null, null, [1774872185, 395271000]],
            [null, 2],
          ],
        ],
        'nb-demo',
        '🕸️',
        null,
        [1, false, true, null, null, [1774889558, 348721000], 1, false, [1774872161, 361922000], null, null, null, false, true, 1, false, null, true, 1],
      ],
    ]);

    expect(rows).toEqual([
      expect.objectContaining({
        id: 'src-pdf',
        type: 'pdf',
        type_code: 3,
      }),
      expect.objectContaining({
        id: 'src-web',
        type: 'web',
        type_code: 5,
      }),
      expect.objectContaining({
        id: 'src-yt',
        type: 'youtube',
        type_code: 9,
      }),
    ]);
  });

  it('parses notebook history thread ids from hPTbtc payload', () => {
    const threadIds = parseNotebooklmHistoryThreadIdsResult([
      [[['28e0f2cb-4591-45a3-a661-7653666f7c78']]],
    ]);

    expect(threadIds).toEqual(['28e0f2cb-4591-45a3-a661-7653666f7c78']);
  });

  it('extracts a notebook history preview from khqZz payload', () => {
    const preview = extractNotebooklmHistoryPreview([
      [
        ['28e0f2cb-4591-45a3-a661-7653666f7c78'],
        [null, 'Summarize this notebook'],
      ],
    ]);

    expect(preview).toBe('Summarize this notebook');
  });

  it('parses notebook notes from studio note rows', () => {
    const rows = parseNotebooklmNoteListRawRows(
      [
        {
          title: '新建笔记',
          text: 'sticky_note_2 新建笔记 6 分钟前 more_vert',
        },
      ],
      'nb-demo',
      'https://notebooklm.google.com/notebook/nb-demo',
    );

    expect(rows).toEqual([
      {
        notebook_id: 'nb-demo',
        title: '新建笔记',
        created_at: '6 分钟前',
        url: 'https://notebooklm.google.com/notebook/nb-demo',
        source: 'studio-list',
      },
    ]);
  });

  it('parses source fulltext from hizoJc payload', () => {
    const row = parseNotebooklmSourceFulltextResult(
      [
        [
          [['src-1']],
          '粘贴的文字',
          [null, 359, [1774872183, 855096000], null, 8, null, 1, ['https://example.com/source']],
          [null, 2],
        ],
        null,
        null,
        [
          [
            [
              [0, 5, [[[0, 5, ['第一段']]]]],
              [5, 10, [[[5, 10, ['第二段']]]]],
            ],
          ],
        ],
      ],
      'nb-demo',
      'https://notebooklm.google.com/notebook/nb-demo',
    );

    expect(row).toEqual({
      source_id: 'src-1',
      notebook_id: 'nb-demo',
      title: '粘贴的文字',
      kind: 'pasted-text',
      content: '第一段\n第二段',
      char_count: 7,
      url: 'https://example.com/source',
      source: 'rpc',
    });
  });

  it('parses source guide from tr032e payloads with either null or source-id envelope in slot 0', () => {
    const source = {
      id: 'src-yt',
      notebook_id: 'nb-demo',
      title: 'Video Source',
      type: 'youtube',
    };

    expect(parseNotebooklmSourceGuideResult([
      [
        [
          null,
          ['Guide summary'],
          [['AI', 'agents']],
          [],
        ],
      ],
    ], source)).toEqual({
      source_id: 'src-yt',
      notebook_id: 'nb-demo',
      title: 'Video Source',
      type: 'youtube',
      summary: 'Guide summary',
      keywords: ['AI', 'agents'],
      source: 'rpc',
    });

    expect(parseNotebooklmSourceGuideResult([
      [
        [
          [['src-yt']],
          ['Guide summary'],
          [['AI', 'agents']],
          [],
        ],
      ],
    ], source)).toEqual({
      source_id: 'src-yt',
      notebook_id: 'nb-demo',
      title: 'Video Source',
      type: 'youtube',
      summary: 'Guide summary',
      keywords: ['AI', 'agents'],
      source: 'rpc',
    });
  });

  it('prefers real NotebookLM page tokens over login text heuristics', async () => {
    let call = 0;
    const page = {
      evaluate: async () => {
        call += 1;
        if (call === 1) {
          return {
            url: 'https://notebooklm.google.com/notebook/nb-demo',
            title: 'Demo Notebook - NotebookLM',
            hostname: 'notebooklm.google.com',
            kind: 'notebook',
            notebookId: 'nb-demo',
            loginRequired: true,
            notebookCount: 0,
          };
        }
        return {
          html: '<html>"SNlM0e":"csrf-123","FdrFJe":"sess-456"</html>',
          sourcePath: '/notebook/nb-demo',
        };
      },
    };

    await expect(getNotebooklmPageState(page as any)).resolves.toEqual({
      url: 'https://notebooklm.google.com/notebook/nb-demo',
      title: 'Demo Notebook - NotebookLM',
      hostname: 'notebooklm.google.com',
      kind: 'notebook',
      notebookId: 'nb-demo',
      loginRequired: false,
      notebookCount: 0,
    });
  });
});
