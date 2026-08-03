import { describe, expect, it } from 'vitest';
import { buildNotebooklmNotebookUrl, buildNotebooklmRpcBody, classifyNotebooklmPage, extractNotebooklmHistoryPreview, extractNotebooklmRpcResult, getNotebooklmPageState, isPlainObject, listNotebooklmLinks, normalizeNotebooklmTitle, parseNotebooklmHistoryThreadIdsResult, parseNotebooklmIdFromUrl, parseNotebooklmListResult, parseNotebooklmNoteListRawRows, parseNotebooklmNotebookDetailResult, parseNotebooklmNotebookTarget, parseNotebooklmSourceFulltextResult, parseNotebooklmSourceGuideResult, parseNotebooklmSourceListResult, readCurrentNotebooklm, requireNotebooklmSession, } from './utils.js';
import { AuthRequiredError, CliError, CommandExecutionError } from '@jackwener/opencli/errors';
import { isNotebooklmHost, parseTrustedNotebooklmUrl } from './shared.js';
describe('notebooklm utils', () => {
    it('matches only the two exact NotebookLM hosts', () => {
        expect(isNotebooklmHost('notebooklm.google.com')).toBe(true);
        expect(isNotebooklmHost('notebook.google.com')).toBe(true);
        expect(isNotebooklmHost('evil.notebooklm.google.com')).toBe(false);
        expect(isNotebooklmHost('notebooklm.google.com.evil.test')).toBe(false);
        expect(isNotebooklmHost('google.com')).toBe(false);
        expect(parseTrustedNotebooklmUrl('https://notebook.google.com/')).not.toBeNull();
        expect(parseTrustedNotebooklmUrl('https://notebooklm.google.com/')).not.toBeNull();
        expect(parseTrustedNotebooklmUrl('http://notebook.google.com/')).toBeNull();
        expect(parseTrustedNotebooklmUrl('https://notebook.google.com:444/')).toBeNull();
        expect(parseTrustedNotebooklmUrl('https://user:secret@notebook.google.com/')).toBeNull();
    });
    it('isPlainObject distinguishes objects from arrays / null / primitives', () => {
        expect(isPlainObject({})).toBe(true);
        expect(isPlainObject({ a: 1 })).toBe(true);
        expect(isPlainObject([])).toBe(false);
        expect(isPlainObject(null)).toBe(false);
        expect(isPlainObject('x')).toBe(false);
        expect(isPlainObject(0)).toBe(false);
    });
    it('parseNotebooklmNotebookTarget accepts canonical uuid input', () => {
        const id = '17e2b882-aaaa-bbbb-cccc-abcdef012345';
        expect(parseNotebooklmNotebookTarget(id)).toBe(id);
    });
    it('parseNotebooklmNotebookTarget accepts a notebook url with uuid', () => {
        const id = '17e2b882-aaaa-bbbb-cccc-abcdef012345';
        expect(parseNotebooklmNotebookTarget(`https://notebooklm.google.com/notebook/${id}?pli=1`)).toBe(id);
    });
    it('parseNotebooklmNotebookTarget accepts NotebookLM redirect-host urls', () => {
        const id = '17e2b882-aaaa-bbbb-cccc-abcdef012345';
        expect(parseNotebooklmNotebookTarget(`https://notebook.google.com/notebook/${id}?pli=1`)).toBe(id);
    });
    it('parseNotebooklmNotebookTarget rejects non-uuid bare ids', () => {
        expect(() => parseNotebooklmNotebookTarget('nb-demo')).toThrow(CliError);
    });
    it('parseNotebooklmNotebookTarget rejects malformed notebook urls', () => {
        expect(() => parseNotebooklmNotebookTarget('https://notebooklm.google.com/notebook/not-a-uuid')).toThrow(CliError);
    });
    it('parseNotebooklmNotebookTarget rejects off-domain or non-canonical notebook urls', () => {
        const id = '17e2b882-aaaa-bbbb-cccc-abcdef012345';
        expect(() => parseNotebooklmNotebookTarget(`https://evil.test/notebook/${id}`)).toThrow(CliError);
        expect(() => parseNotebooklmNotebookTarget(`http://notebooklm.google.com/notebook/${id}`)).toThrow(CliError);
        expect(() => parseNotebooklmNotebookTarget(`https://notebooklm.google.com:444/notebook/${id}`)).toThrow(CliError);
        expect(() => parseNotebooklmNotebookTarget(`https://user:notsecret@notebooklm.google.com/notebook/${id}`)).toThrow(CliError);
    });
    it('parseNotebooklmNotebookTarget rejects empty input', () => {
        expect(() => parseNotebooklmNotebookTarget('')).toThrow(CliError);
        expect(() => parseNotebooklmNotebookTarget('   ')).toThrow(CliError);
    });
    it('parses notebook id from a notebook url', () => {
        expect(parseNotebooklmIdFromUrl('https://notebooklm.google.com/notebook/abc-123')).toBe('abc-123');
    });
    it('returns empty string when notebook id is absent', () => {
        expect(parseNotebooklmIdFromUrl('https://notebooklm.google.com/')).toBe('');
    });
    it('classifies notebook pages correctly', () => {
        expect(classifyNotebooklmPage('https://notebooklm.google.com/notebook/demo-id')).toBe('notebook');
        expect(classifyNotebooklmPage('https://notebooklm.google.com/')).toBe('home');
        expect(classifyNotebooklmPage('https://notebook.google.com/notebook/demo-id')).toBe('notebook');
        expect(classifyNotebooklmPage('https://notebook.google.com/')).toBe('home');
        expect(classifyNotebooklmPage('https://example.com/notebook/demo-id')).toBe('unknown');
        expect(classifyNotebooklmPage('http://notebook.google.com/notebook/demo-id')).toBe('unknown');
        expect(classifyNotebooklmPage('https://notebook.google.com:444/notebook/demo-id')).toBe('unknown');
    });
    it('builds new canonical URLs by default and preserves an observed trusted origin', () => {
        const id = '17e2b882-aaaa-bbbb-cccc-abcdef012345';
        expect(buildNotebooklmNotebookUrl(id)).toBe(`https://notebook.google.com/notebook/${id}`);
        expect(buildNotebooklmNotebookUrl(id, 'https://notebooklm.google.com/?pli=1')).toBe(`https://notebooklm.google.com/notebook/${id}`);
        expect(buildNotebooklmNotebookUrl(id, 'https://notebook.google.com.evil.test/')).toBe(`https://notebook.google.com/notebook/${id}`);
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
        expect(result[0]).toBeDefined();
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
                url: 'https://notebook.google.com/notebook/nb1',
                source: 'rpc',
                is_owner: true,
                created_at: '2024-01-01T00:00:00.000Z',
            },
        ]);
    });
    it('distinguishes a healthy empty list payload from schema drift', () => {
        expect(parseNotebooklmListResult([[]])).toEqual([]);
        expect(() => parseNotebooklmListResult({ rows: [] })).toThrowError(expect.objectContaining({ code: 'NOTEBOOKLM_RPC_SCHEMA' }));
        expect(() => parseNotebooklmListResult([[['title-only']]])).toThrowError(expect.objectContaining({ code: 'NOTEBOOKLM_RPC_SCHEMA' }));
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
            url: 'https://notebook.google.com/notebook/nb-demo',
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
            url: 'https://notebook.google.com/notebook/nb-demo',
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
                url: 'https://notebook.google.com/notebook/nb-demo',
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
                url: 'https://notebook.google.com/notebook/nb-demo',
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
                url: 'https://notebook.google.com/notebook/nb-demo',
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
        const rows = parseNotebooklmNoteListRawRows([
            {
                title: '新建笔记',
                text: 'sticky_note_2 新建笔记 6 分钟前 more_vert',
            },
        ], 'nb-demo', 'https://notebooklm.google.com/notebook/nb-demo');
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
        const row = parseNotebooklmSourceFulltextResult([
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
        ], 'nb-demo', 'https://notebooklm.google.com/notebook/nb-demo');
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
                    readyState: 'complete',
                    csrfToken: '',
                    sessionId: '',
                    authuser: '',
                    url: 'https://notebooklm.google.com/notebook/nb-demo',
                };
            },
        };
        await expect(getNotebooklmPageState(page)).resolves.toEqual({
            url: 'https://notebooklm.google.com/notebook/nb-demo',
            title: 'Demo Notebook - NotebookLM',
            hostname: 'notebooklm.google.com',
            kind: 'notebook',
            notebookId: 'nb-demo',
            loginRequired: false,
            notebookCount: 0,
        });
    });
    it('reads page state through Browser Bridge evaluate envelopes', async () => {
        const page = {
            evaluate: async () => ({
                session: 'site:notebooklm:abc',
                data: {
                    url: 'https://notebooklm.google.com/notebook/nb-demo',
                    title: 'Demo Notebook - NotebookLM',
                    hostname: 'notebooklm.google.com',
                    kind: 'notebook',
                    notebookId: 'nb-demo',
                    loginRequired: false,
                    notebookCount: 0,
                },
            }),
        };
        await expect(getNotebooklmPageState(page)).resolves.toEqual({
            url: 'https://notebooklm.google.com/notebook/nb-demo',
            title: 'Demo Notebook - NotebookLM',
            hostname: 'notebooklm.google.com',
            kind: 'notebook',
            notebookId: 'nb-demo',
            loginRequired: false,
            notebookCount: 0,
        });
    });
    it('accepts page state from the NotebookLM redirect host', async () => {
        const page = {
            evaluate: async () => ({
                url: 'https://notebook.google.com/notebook/nb-demo',
                title: 'Demo Notebook - NotebookLM',
                hostname: 'notebook.google.com',
                kind: 'notebook',
                notebookId: 'nb-demo',
                loginRequired: false,
                notebookCount: 2,
            }),
        };
        await expect(getNotebooklmPageState(page)).resolves.toEqual({
            url: 'https://notebook.google.com/notebook/nb-demo',
            title: 'Demo Notebook - NotebookLM',
            hostname: 'notebook.google.com',
            kind: 'notebook',
            notebookId: 'nb-demo',
            loginRequired: false,
            notebookCount: 2,
        });
    });
    it('treats the trusted new-host login path as authentication-required', async () => {
        const page = {
            evaluate: async () => ({
                url: 'https://notebook.google.com/login?continue=x',
                title: 'Sign in',
                hostname: 'notebook.google.com',
                kind: 'home',
                notebookId: '',
                loginRequired: false,
                notebookCount: 0,
            }),
        };
        await expect(requireNotebooklmSession(page)).rejects.toBeInstanceOf(AuthRequiredError);
    });
    it('typed-fails malformed page-state Browser Bridge envelopes', async () => {
        const page = {
            evaluate: async () => ({ session: 'site:notebooklm:test', data: null }),
        };
        await expect(getNotebooklmPageState(page)).rejects.toBeInstanceOf(CommandExecutionError);
    });
    it('preserves a trusted active origin for current-page rows and rejects off-host rows', async () => {
        const valid = {
            evaluate: async () => ({
                id: 'nb-demo',
                title: 'Demo',
                url: 'https://notebooklm.google.com/notebook/nb-demo?pli=1',
            }),
        };
        await expect(readCurrentNotebooklm(valid)).resolves.toMatchObject({
            id: 'nb-demo',
            url: 'https://notebooklm.google.com/notebook/nb-demo',
            source: 'current-page',
        });
        const offHost = {
            evaluate: async () => ({
                id: 'nb-demo',
                title: 'Demo',
                url: 'https://evil.test/notebook/nb-demo',
            }),
        };
        await expect(readCurrentNotebooklm(offHost)).rejects.toBeInstanceOf(CommandExecutionError);
    });
    it('validates each DOM fallback row and normalizes its trusted URL', async () => {
        const valid = {
            evaluate: async () => [{
                id: 'nb-demo',
                title: 'Demo',
                url: 'https://notebook.google.com/notebook/nb-demo?pli=1',
                is_owner: true,
                created_at: null,
            }],
        };
        await expect(listNotebooklmLinks(valid)).resolves.toEqual([{
            id: 'nb-demo',
            title: 'Demo',
            url: 'https://notebook.google.com/notebook/nb-demo',
            source: 'home-links',
            is_owner: true,
            created_at: null,
        }]);
        const mismatched = {
            evaluate: async () => [{
                id: 'nb-demo',
                title: 'Demo',
                url: 'https://notebook.google.com/notebook/other',
                is_owner: true,
                created_at: null,
            }],
        };
        await expect(listNotebooklmLinks(mismatched)).rejects.toBeInstanceOf(CommandExecutionError);
    });
});
