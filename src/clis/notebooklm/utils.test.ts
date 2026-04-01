import { describe, expect, it } from 'vitest';
import type { NotebooklmDownloadListRow } from './shared.js';
import {
  buildNotebooklmCreateNotebookParams,
  buildNotebooklmDeleteNotebookParams,
  buildNotebooklmGenerateAudioParams,
  buildNotebooklmGenerateReportParams,
  buildNotebooklmGenerateSlideDeckParams,
  buildNotebooklmRemoveFromRecentParams,
  buildNotebooklmRenameNotebookParams,
  buildNotebooklmAddTextParams,
  buildNotebooklmAddFileParams,
  buildNotebooklmAddUrlParams,
  buildNotebooklmAddYoutubeParams,
  buildNotebooklmGetLanguageParams,
  buildNotebooklmRenameSourceParams,
  buildNotebooklmSetLanguageParams,
  buildNotebooklmUpdateNoteParams,
  buildNotebooklmAskBody,
  buildNotebooklmRpcBody,
  classifyNotebooklmPage,
  extractNotebooklmStableIdFromHints,
  extractNotebooklmHistoryPreview,
  extractNotebooklmRpcResult,
  getNotebooklmPageState,
  normalizeNotebooklmTitle,
  parseNotebooklmAskResponse,
  parseNotebooklmArtifactListResult,
  parseNotebooklmCreatedSourceResult,
  parseNotebooklmHistoryThreadIdsResult,
  parseNotebooklmIdFromUrl,
  parseNotebooklmLanguageGetResult,
  parseNotebooklmLanguageSetResult,
  parseNotebooklmNotebookDescriptionResult,
  parseNotebooklmListResult,
  parseNotebooklmNotesRpcResult,
  parseNotebooklmNoteListRawRows,
  parseNotebooklmNotebookDetailResult,
  parseNotebooklmShareStatusResult,
  parseNotebooklmSourceFulltextResult,
  parseNotebooklmSourceGuideResult,
  parseNotebooklmSourceFreshnessResult,
  parseNotebooklmSourceListResult,
  parseNotebooklmSourceListResultWithStatus,
  parseNotebooklmDownloadListRows,
  parseNotebooklmGenerationFailureFromRpcBody,
  classifyNotebooklmGenerationFailureMessage,
  pickNotebooklmArtifactIdCompletionCandidates,
  parseNotebooklmGenerationResult,
  selectNotebooklmCompletedArtifact,
  extractNotebooklmAudioDownloadVariant,
  extractNotebooklmVideoDownloadVariant,
  extractNotebooklmSlideDeckDownloadUrl,
  extractNotebooklmReportMarkdown,
  resolveNotebooklmVisibleNoteId,
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

  it('builds the notebooklm ask body with source ids, prompt, and csrf token', () => {
    const body = buildNotebooklmAskBody(
      ['src-1', 'src-2'],
      '用一句话总结这个 notebook',
      'csrf123',
      'conv-123',
    );
    const params = new URLSearchParams(body.slice(0, -1));
    const encodedRequest = params.get('f.req');
    const [, encodedPayload] = JSON.parse(encodedRequest ?? '[]') as [null, string];
    const [sourceIds, prompt, conversationHistory, chatOptions, conversationId] = JSON.parse(encodedPayload);

    expect(body).toContain('f.req=');
    expect(body).toContain('at=csrf123');
    expect(body.endsWith('&')).toBe(true);
    expect(sourceIds).toEqual([[[ 'src-1' ]], [[ 'src-2' ]]]);
    expect(prompt).toBe('用一句话总结这个 notebook');
    expect(conversationHistory).toBeNull();
    expect(chatOptions).toEqual([2, null, [1]]);
    expect(conversationId).toBe('conv-123');
  });

  it('builds add-text rpc params with title and content in the pasted-text slot', () => {
    expect(buildNotebooklmAddTextParams('贴入内容', '第一段\n第二段', 'nb-demo')).toEqual([
      [[null, ['贴入内容', '第一段\n第二段'], null, null, null, null, null, null]],
      'nb-demo',
      [2],
      null,
      null,
    ]);
  });

  it('builds add-file rpc params with the filename nested in the upload registration slot', () => {
    expect(buildNotebooklmAddFileParams('demo.txt', 'nb-demo')).toEqual([
      [['demo.txt']],
      'nb-demo',
      [2],
      [1, null, null, null, null, null, null, null, null, null, [1]],
    ]);
  });

  it('builds create-notebook rpc params for the home-page create flow', () => {
    expect(buildNotebooklmCreateNotebookParams('新建 Notebook')).toEqual([
      '新建 Notebook',
      null,
      null,
      [2],
      [1, null, null, null, null, null, null, null, null, null, [1]],
    ]);
  });

  it('builds rename-notebook rpc params for the home-scope notebook settings endpoint', () => {
    expect(buildNotebooklmRenameNotebookParams('nb-demo', '重命名后的 Notebook')).toEqual([
      'nb-demo',
      [[null, null, null, [null, '重命名后的 Notebook']]],
    ]);
  });

  it('builds delete-notebook rpc params for the home-scope delete endpoint', () => {
    expect(buildNotebooklmDeleteNotebookParams('nb-demo')).toEqual([
      ['nb-demo'],
      [2],
    ]);
  });

  it('builds remove-from-recent rpc params for the home-scope recent list endpoint', () => {
    expect(buildNotebooklmRemoveFromRecentParams('nb-demo')).toEqual(['nb-demo']);
  });

  it('builds add-url rpc params with the target url in the web slot', () => {
    expect(buildNotebooklmAddUrlParams('https://example.com/article', 'nb-demo')).toEqual([
      [[null, null, ['https://example.com/article'], null, null, null, null, null]],
      'nb-demo',
      [2],
      null,
      null,
    ]);
  });

  it('builds youtube add-source params when the url is a youtube video', () => {
    expect(buildNotebooklmAddYoutubeParams('https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'nb-demo')).toEqual([
      [[null, null, null, null, null, null, null, ['https://www.youtube.com/watch?v=dQw4w9WgXcQ'], null, null, 1]],
      'nb-demo',
      [2],
      [1, null, null, null, null, null, null, null, null, null, [1]],
    ]);
  });

  it('builds update-note rpc params with notebook id, note id, title, and content', () => {
    expect(buildNotebooklmUpdateNoteParams('nb-demo', 'note-1', '重命名后的标题', '更新后的内容')).toEqual([
      'nb-demo',
      'note-1',
      [[['更新后的内容', '重命名后的标题', [], 0]]],
    ]);
  });

  it('builds rename-source rpc params with source id and new title', () => {
    expect(buildNotebooklmRenameSourceParams('src-1', '重命名后的来源')).toEqual([
      null,
      ['src-1'],
      [[['重命名后的来源']]],
    ]);
  });

  it('builds get-language rpc params for the global user settings endpoint', () => {
    expect(buildNotebooklmGetLanguageParams()).toEqual([
      null,
      [1, null, null, null, null, null, null, null, null, null, [1]],
    ]);
  });

  it('extracts a stable note id from note-label and artifact-label dom hints', () => {
    expect(extractNotebooklmStableIdFromHints([
      'ql-editor',
      'note-labels-ca68cf01-4c3d-47e5-88b6-6e5f259b7313',
      'artifact-labels-ignored',
    ])).toBe('ca68cf01-4c3d-47e5-88b6-6e5f259b7313');

    expect(extractNotebooklmStableIdFromHints([
      'artifact-labels-6a31b7d3-7b9c-402d-a4dc-fcc396430de4',
    ])).toBe('6a31b7d3-7b9c-402d-a4dc-fcc396430de4');
  });

  it('prefers the visible editor id when duplicate titles exist in rpc notes', () => {
    expect(resolveNotebooklmVisibleNoteId(
      {
        id: 'ca68cf01-4c3d-47e5-88b6-6e5f259b7313',
        title: '新建笔记',
        content: '',
      },
      [
        {
          notebook_id: 'nb-demo',
          id: '28bad145-f62f-4a62-ad3d-61a2327d3c6f',
          title: '新建笔记',
          content: '旧内容',
          url: 'https://notebooklm.google.com/notebook/nb-demo',
          source: 'rpc',
        },
        {
          notebook_id: 'nb-demo',
          id: 'ca68cf01-4c3d-47e5-88b6-6e5f259b7313',
          title: '新建笔记',
          content: '',
          url: 'https://notebooklm.google.com/notebook/nb-demo',
          source: 'rpc',
        },
      ],
    )).toEqual({
      id: 'ca68cf01-4c3d-47e5-88b6-6e5f259b7313',
      reason: 'visible-id',
    });
  });

  it('falls back to an exact title-and-content match when the visible editor has no id', () => {
    expect(resolveNotebooklmVisibleNoteId(
      {
        id: null,
        title: '新建笔记',
        content: '这是当前打开的正文',
      },
      [
        {
          notebook_id: 'nb-demo',
          id: 'note-older',
          title: '新建笔记',
          content: '另一条内容',
          url: 'https://notebooklm.google.com/notebook/nb-demo',
          source: 'rpc',
        },
        {
          notebook_id: 'nb-demo',
          id: 'note-current',
          title: '新建笔记',
          content: '这是当前打开的正文',
          url: 'https://notebooklm.google.com/notebook/nb-demo',
          source: 'rpc',
        },
      ],
    )).toEqual({
      id: 'note-current',
      reason: 'title-content',
    });
  });

  it('builds set-language rpc params for the global user settings endpoint', () => {
    expect(buildNotebooklmSetLanguageParams('zh_Hans')).toEqual([
      [[null, [[null, null, null, null, ['zh_Hans']]]]],
    ]);
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
          id: 'note-labels-ca68cf01-4c3d-47e5-88b6-6e5f259b7313',
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
        id: 'ca68cf01-4c3d-47e5-88b6-6e5f259b7313',
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

  it('parses notebook description rows from summarize rpc payload', () => {
    expect(parseNotebooklmNotebookDescriptionResult(
      [
        ['这是 notebook 的摘要。'],
        [[
          ['问题一？', 'Prompt one'],
          ['问题二？', 'Prompt two'],
        ]],
      ],
      'nb-demo',
      'https://notebooklm.google.com/notebook/nb-demo',
    )).toEqual({
      notebook_id: 'nb-demo',
      summary: '这是 notebook 的摘要。',
      suggested_topics: [
        { question: '问题一？', prompt: 'Prompt one' },
        { question: '问题二？', prompt: 'Prompt two' },
      ],
      suggested_topic_count: 2,
      url: 'https://notebooklm.google.com/notebook/nb-demo',
      source: 'rpc',
    });
  });

  it('parses note rows from get-notes rpc payload', () => {
    expect(parseNotebooklmNotesRpcResult([
      [
        ['note-1', ['note-1', '第一段\n第二段', null, null, '新建笔记']],
        ['note-2', null, 2],
      ],
    ], 'nb-demo', 'https://notebooklm.google.com/notebook/nb-demo')).toEqual([
      {
        notebook_id: 'nb-demo',
        id: 'note-1',
        title: '新建笔记',
        content: '第一段\n第二段',
        url: 'https://notebooklm.google.com/notebook/nb-demo',
        source: 'rpc',
      },
    ]);
  });

  it('parses source processing status from source[3][1] when requested by wait helpers', () => {
    const rows = parseNotebooklmSourceListResultWithStatus([
      [
        'Browser Automation',
        [
          [
            ['src-processing'],
            'Uploading.pdf',
            [null, 18940, [1774872183, 855096000], ['doc1', [1774872183, 356519000]], 3, null, 1, null, null, null, null, null, null, null, [1774872185, 395271000]],
            [null, 5],
          ],
          [
            ['src-ready'],
            'Ready.md',
            [null, 131, [1774872183, 855096000], ['doc2', [1774872183, 356519000]], 8, null, 1, null, null, null, null, null, null, null, [1774872185, 395271000]],
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
        id: 'src-processing',
        status: 'preparing',
        status_code: 5,
      }),
      expect.objectContaining({
        id: 'src-ready',
        status: 'ready',
        status_code: 2,
      }),
    ]);
  });

  it('parses share status rows from get-share-status rpc payload', () => {
    expect(parseNotebooklmShareStatusResult(
      [
        [
          ['user@example.com', 3, [], ['User Example', 'https://avatar.test/user.png']],
        ],
        [1],
        1000,
      ],
      'nb-demo',
    )).toEqual({
      notebook_id: 'nb-demo',
      is_public: true,
      access: 'anyone_with_link',
      view_level: 'full',
      share_url: 'https://notebooklm.google.com/notebook/nb-demo',
      shared_user_count: 1,
      shared_users: [
        {
          email: 'user@example.com',
          permission: 'viewer',
          display_name: 'User Example',
          avatar_url: 'https://avatar.test/user.png',
        },
      ],
      source: 'rpc',
    });
  });

  it('parses the current output language from get-user-settings payload', () => {
    expect(parseNotebooklmLanguageGetResult([
      [null, null, [null, null, null, null, ['ja']]],
    ])).toBe('ja');
  });

  it('parses the updated output language from set-user-settings payload', () => {
    expect(parseNotebooklmLanguageSetResult([null, null, [null, null, null, null, ['zh_Hans']]])).toBe('zh_Hans');
  });

  it('parses source freshness results across url, drive, and boolean payload shapes', () => {
    expect(parseNotebooklmSourceFreshnessResult([])).toBe(true);
    expect(parseNotebooklmSourceFreshnessResult([[null, true, ['src-1']]])).toBe(true);
    expect(parseNotebooklmSourceFreshnessResult(true)).toBe(true);
    expect(parseNotebooklmSourceFreshnessResult(false)).toBe(false);
    expect(parseNotebooklmSourceFreshnessResult([[null, false, ['src-1']]])).toBe(false);
  });

  it('parses a created source from add-source rpc payload', () => {
    const row = parseNotebooklmCreatedSourceResult(
      [
        [
          [
            ['src-created'],
            '贴入内容',
            [null, 12, [1774872183, 855096000], null, 8, null, 1, null],
          ],
        ],
      ],
      'nb-demo',
      'https://notebooklm.google.com/notebook/nb-demo',
    );

    expect(row).toEqual({
      id: 'src-created',
      notebook_id: 'nb-demo',
      title: '贴入内容',
      url: 'https://notebooklm.google.com/notebook/nb-demo',
      source: 'rpc',
      type: 'pasted-text',
      type_code: 8,
      size: 12,
      created_at: '2026-03-30T12:03:03.855Z',
      updated_at: null,
    });
  });

  it('extracts the longest marked answer from the notebooklm ask response', () => {
    const partialChunk = JSON.stringify([
      [
        'wrb.fr',
        null,
        JSON.stringify([
          [
            '较短的中间输出',
            null,
            [],
            null,
            [[], null, null, 0],
          ],
        ]),
      ],
    ]);

    const finalChunk = JSON.stringify([
      [
        'wrb.fr',
        null,
        JSON.stringify([
          [
            '最终回答正文',
            null,
            [],
            null,
            [[], null, null, 1],
          ],
        ]),
      ],
    ]);

    const raw = `)]}'\n128\n${partialChunk}\n256\n${finalChunk}`;
    expect(parseNotebooklmAskResponse(raw)).toBe('最终回答正文');
  });

  it('parses artifact rows, selects the latest completed report, and extracts markdown content', () => {
    const result = [
      [
        ['report-1', 'Briefing Doc: Browser Automation', 2, null, 3, null, null, ['# older'], null, null, null, null, null, null, null, [100]],
        ['report-2', 'Study Guide: Browser Automation', 2, null, 3, null, null, ['# latest'], null, null, null, null, null, null, null, [200]],
        ['slide-1', 'Browser Automation Deck', 8, null, 3, null, null, null, null, null, null, null, null, null, null, [300]],
      ],
    ];

    const rows = parseNotebooklmArtifactListResult(result);
    const report = selectNotebooklmCompletedArtifact(rows, 2);

    expect(rows).toHaveLength(3);
    expect(report?.[0]).toBe('report-2');
    expect(extractNotebooklmReportMarkdown(report ?? null)).toBe('# latest');
  });

  it('builds the NotebookLM report generation payload for create-artifact RPC', () => {
    expect(buildNotebooklmGenerateReportParams('nb-demo', ['src-1', 'src-2'])).toEqual([
      [2],
      'nb-demo',
      [
        null,
        null,
        2,
        [[['src-1']], [['src-2']]],
        null,
        null,
        null,
        [
          null,
          [
            'Briefing Doc',
            'Key insights and important quotes',
            null,
            [['src-1'], ['src-2']],
            'en',
            'Create a comprehensive briefing document that includes an Executive Summary, detailed analysis of key themes, important quotes with context, and actionable insights.',
            null,
            true,
          ],
        ],
      ],
    ]);
  });

  it('builds the NotebookLM audio generation payload for create-artifact RPC', () => {
    expect(buildNotebooklmGenerateAudioParams('nb-demo', ['src-1', 'src-2'])).toEqual([
      [2],
      'nb-demo',
      [
        null,
        null,
        1,
        [[['src-1']], [['src-2']]],
        null,
        null,
        [
          null,
          [
            null,
            null,
            null,
            [['src-1'], ['src-2']],
            'en',
            null,
            null,
          ],
        ],
      ],
    ]);
  });

  it('builds the NotebookLM slide-deck generation payload for create-artifact RPC', () => {
    expect(buildNotebooklmGenerateSlideDeckParams('nb-demo', ['src-1', 'src-2'])).toEqual([
      [2],
      'nb-demo',
      [
        null,
        null,
        8,
        [[['src-1']], [['src-2']]],
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        [[null, 'en', null, null]],
      ],
    ]);
  });

  it('parses NotebookLM generation RPC results into artifact id and normalized status', () => {
    expect(parseNotebooklmGenerationResult([
      ['artifact-pending', 'Briefing Doc', 2, null, 2],
    ])).toEqual({
      artifact_id: 'artifact-pending',
      status: 'pending',
    });

    expect(parseNotebooklmGenerationResult([
      ['artifact-completed', 'Briefing Doc', 2, null, 3],
    ])).toEqual({
      artifact_id: 'artifact-completed',
      status: 'completed',
    });

    expect(parseNotebooklmGenerationResult(null)).toEqual({
      artifact_id: null,
      status: 'failed',
    });
  });

  it('extracts slide-deck download urls from the completed artifact payload', () => {
    const result = [
      [
        ['slide-1', 'Older deck', 8, null, 3, null, null, null, null, null, null, null, null, null, null, [100], [null, null, null, 'https://example.com/older.pdf', 'https://example.com/older.pptx']],
        ['slide-2', 'Latest deck', 8, null, 3, null, null, null, null, null, null, null, null, null, null, [200], [null, null, null, 'https://example.com/latest.pdf', 'https://example.com/latest.pptx']],
      ],
    ];

    const rows = parseNotebooklmArtifactListResult(result);
    const slideDeck = selectNotebooklmCompletedArtifact(rows, 8);

    expect(slideDeck?.[0]).toBe('slide-2');
    expect(extractNotebooklmSlideDeckDownloadUrl(slideDeck ?? null, 'pdf')).toBe('https://example.com/latest.pdf');
    expect(extractNotebooklmSlideDeckDownloadUrl(slideDeck ?? null, 'pptx')).toBe('https://example.com/latest.pptx');
  });

  it('extracts the preferred audio/mp4 download variant from the completed artifact payload', () => {
    const result = [
      [
        ['audio-1', 'Older audio', 1, null, 3, null, [null, null, null, null, null, [['https://example.com/older-hls', 2], ['https://example.com/older-audio', 1, 'audio/mp4']]], null, null, null, null, null, null, null, null, [100]],
        ['audio-2', 'Latest audio', 1, null, 3, null, [null, null, null, null, null, [['https://example.com/latest-audio-dv', 4, 'audio/mp4'], ['https://example.com/latest-audio', 1, 'audio/mp4'], ['https://example.com/latest-hls', 2], ['https://example.com/latest-dash', 3]]], null, null, null, null, null, null, null, null, [200]],
      ],
    ];

    const rows = parseNotebooklmArtifactListResult(result);
    const audio = selectNotebooklmCompletedArtifact(rows, 1);

    expect(audio?.[0]).toBe('audio-2');
    expect(extractNotebooklmAudioDownloadVariant(audio ?? null)).toEqual({
      url: 'https://example.com/latest-audio-dv',
      mime_type: 'audio/mp4',
    });
  });

  it('falls back to the first audio variant when no mime-tagged audio/mp4 variant exists', () => {
    const row = [
      'audio-3', 'Fallback audio', 1, null, 3, null,
      [null, null, null, null, null, [['https://example.com/fallback-hls', 2], ['https://example.com/fallback-dash', 3]]],
    ];

    expect(extractNotebooklmAudioDownloadVariant(row)).toEqual({
      url: 'https://example.com/fallback-hls',
      mime_type: null,
    });
  });

  it('extracts the preferred video/mp4 download variant from the completed artifact payload', () => {
    const result = [
      [
        ['video-1', 'Older video', 3, null, 3, null, null, null, [null, null, null, 'https://example.com/older-video-dv', [['https://example.com/older-video', 1, 'video/mp4'], ['https://example.com/older-video-dv', 4, 'video/mp4'], ['https://example.com/older-video-hls', 2], ['https://example.com/older-video-dash', 3]]], null, null, null, null, null, null, [100]],
        ['video-2', 'Latest video', 3, null, 3, null, null, null, [null, null, null, 'https://example.com/latest-video-dv', [['https://example.com/latest-video', 1, 'video/mp4'], ['https://example.com/latest-video-dv', 4, 'video/mp4'], ['https://example.com/latest-video-hls', 2], ['https://example.com/latest-video-dash', 3]], [314, 999999000]], null, null, null, null, null, null, [200]],
      ],
    ];

    const rows = parseNotebooklmArtifactListResult(result);
    const video = selectNotebooklmCompletedArtifact(rows, 3);

    expect(video?.[0]).toBe('video-2');
    expect(extractNotebooklmVideoDownloadVariant(video ?? null)).toEqual({
      url: 'https://example.com/latest-video',
      mime_type: 'video/mp4',
    });
  });

  it('falls back to the first video variant when no mime-tagged video/mp4 variant exists', () => {
    const row = [
      'video-3', 'Fallback video', 3, null, 3, null, null, null,
      [null, null, null, null, [['https://example.com/fallback-hls', 2], ['https://example.com/fallback-dash', 3]]],
    ];

    expect(extractNotebooklmVideoDownloadVariant(row)).toEqual({
      url: 'https://example.com/fallback-hls',
      mime_type: null,
    });
  });

  it('parses supported downloadable artifact rows into a minimal download index', () => {
    const result = [
      [
        ['report-1', 'Browser Automation Report', 2, null, 3, null, null, ['# report body'], null, null, null, null, null, null, null, [100]],
        ['audio-1', 'Browser Automation Audio', 1, null, 3, null, [null, null, null, null, null, [['https://example.com/audio.mp4', 1, 'audio/mp4'], ['https://example.com/audio.m3u8', 2], ['https://example.com/audio.mpd', 3]]], null, null, null, null, null, null, null, null, [200]],
        ['video-1', 'Browser Automation Video', 3, null, 2, null, null, null, [null, null, null, null, [['https://example.com/video.m3u8', 2], ['https://example.com/video.mp4', 1, 'video/mp4']]], null, null, null, null, null, null, [300]],
        ['slide-1', 'Browser Automation Deck', 8, null, 3, null, null, null, null, null, null, null, null, null, null, [400], [null, null, null, 'https://example.com/deck.pdf', 'https://example.com/deck.pptx']],
        ['other-1', 'Unsupported Artifact', 4, null, 3, null, null, null, null, null, null, null, null, null, null, [500]],
      ],
    ];

    const rows = parseNotebooklmArtifactListResult(result);
    const downloadRows = parseNotebooklmDownloadListRows(
      rows,
      'nb-demo',
      'https://notebooklm.google.com/notebook/nb-demo',
    );

    expect(downloadRows).toHaveLength(4);
    expect(downloadRows.map((row) => row.artifact_id)).toEqual(['slide-1', 'video-1', 'audio-1', 'report-1']);
    expect(downloadRows.find((row) => row.artifact_id === 'report-1')).toEqual({
      notebook_id: 'nb-demo',
      artifact_id: 'report-1',
      artifact_type: 'report',
      status: 'completed',
      title: 'Browser Automation Report',
      created_at: '1970-01-01T00:01:40.000Z',
      download_variants: ['markdown'],
      source: 'rpc+artifact-list',
    });
    expect(downloadRows.find((row) => row.artifact_id === 'audio-1')).toEqual({
      notebook_id: 'nb-demo',
      artifact_id: 'audio-1',
      artifact_type: 'audio',
      status: 'completed',
      title: 'Browser Automation Audio',
      created_at: '1970-01-01T00:03:20.000Z',
      download_variants: ['audio/mp4', 'hls', 'dash'],
      source: 'rpc+artifact-list',
    });
    expect(downloadRows.find((row) => row.artifact_id === 'video-1')).toEqual({
      notebook_id: 'nb-demo',
      artifact_id: 'video-1',
      artifact_type: 'video',
      status: 'status_2',
      title: 'Browser Automation Video',
      created_at: '1970-01-01T00:05:00.000Z',
      download_variants: ['hls', 'video/mp4'],
      source: 'rpc+artifact-list',
    });
    expect(downloadRows.find((row) => row.artifact_id === 'slide-1')).toEqual({
      notebook_id: 'nb-demo',
      artifact_id: 'slide-1',
      artifact_type: 'slide_deck',
      status: 'completed',
      title: 'Browser Automation Deck',
      created_at: '1970-01-01T00:06:40.000Z',
      download_variants: ['pdf', 'pptx'],
      source: 'rpc+artifact-list',
    });
  });

  it('filters artifact-id completion candidates by supported NotebookLM download type', () => {
    const rows: NotebooklmDownloadListRow[] = [
      {
        notebook_id: 'nb-demo',
        artifact_id: 'report-1',
        artifact_type: 'report',
        status: 'completed',
        title: 'Report',
        created_at: '2026-03-31T00:00:00.000Z',
        download_variants: ['markdown'],
        source: 'rpc+artifact-list',
      },
      {
        notebook_id: 'nb-demo',
        artifact_id: 'audio-1',
        artifact_type: 'audio',
        status: 'completed',
        title: 'Audio',
        created_at: '2026-03-31T00:01:00.000Z',
        download_variants: ['audio/mp4'],
        source: 'rpc+artifact-list',
      },
      {
        notebook_id: 'nb-demo',
        artifact_id: 'video-1',
        artifact_type: 'video',
        status: 'completed',
        title: 'Video',
        created_at: '2026-03-31T00:02:00.000Z',
        download_variants: ['video/mp4'],
        source: 'rpc+artifact-list',
      },
      {
        notebook_id: 'nb-demo',
        artifact_id: 'slide-1',
        artifact_type: 'slide_deck',
        status: 'completed',
        title: 'Deck',
        created_at: '2026-03-31T00:03:00.000Z',
        download_variants: ['pdf', 'pptx'],
        source: 'rpc+artifact-list',
      },
    ];

    expect(pickNotebooklmArtifactIdCompletionCandidates(rows, 'report')).toEqual(['report-1']);
    expect(pickNotebooklmArtifactIdCompletionCandidates(rows, 'audio')).toEqual(['audio-1']);
    expect(pickNotebooklmArtifactIdCompletionCandidates(rows, 'video')).toEqual(['video-1']);
    expect(pickNotebooklmArtifactIdCompletionCandidates(rows, 'slide_deck')).toEqual(['slide-1']);
  });

  it('classifies generation failure messages into explicit diagnostic buckets', () => {
    expect(classifyNotebooklmGenerationFailureMessage(
      'You reached your daily limit for audio overviews and slides today. Upgrade to continue.',
    )).toBe('daily_limit_reached');
    expect(classifyNotebooklmGenerationFailureMessage(
      'This feature is not eligible on your current plan. Upgrade to continue.',
    )).toBe('feature_not_eligible');
    expect(classifyNotebooklmGenerationFailureMessage(
      'There is not enough content in this notebook to generate an audio overview yet.',
    )).toBe('content_insufficient');
    expect(classifyNotebooklmGenerationFailureMessage(null)).toBe('generation_failed_unknown');
  });

  it('parses UserDisplayableError generation failures into diagnostic metadata', () => {
    const raw = `)]}'\n228\n[["wrb.fr","R7cb6c",null,null,"You reached your daily limit for audio overviews and slides today. Upgrade to continue.",[8,null,[["type.googleapis.com/google.internal.labs.tailwind.orchestration.v1.UserDisplayableError",[]]]],"generic"]]`;

    expect(parseNotebooklmGenerationFailureFromRpcBody(raw)).toEqual({
      error_type: 'daily_limit_reached',
      message: 'You reached your daily limit for audio overviews and slides today. Upgrade to continue.',
    });
  });

  it('falls back to unknown generation failures when UserDisplayableError has no readable message', () => {
    const raw = `)]}'\n220\n[["wrb.fr","R7cb6c",null,null,null,[8,null,[["type.googleapis.com/google.internal.labs.tailwind.orchestration.v1.UserDisplayableError",[[null,[[1]]]]]]],"generic"]]`;

    expect(parseNotebooklmGenerationFailureFromRpcBody(raw)).toEqual({
      error_type: 'generation_failed_unknown',
      message: null,
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
