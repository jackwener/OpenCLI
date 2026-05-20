import { describe, expect, it, afterEach, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { __test__ as jiraSharedTest } from './shared.js';
import './issue.js';
import './search.js';
import './comments.js';
import './attachments.js';
import './links.js';

const ENV_KEYS = [
    'ATLASSIAN_JIRA_BASE_URL',
    'ATLASSIAN_DEPLOYMENT',
    'ATLASSIAN_EMAIL',
    'ATLASSIAN_API_TOKEN',
    'ATLASSIAN_USERNAME',
    'ATLASSIAN_PASSWORD',
    'ATLASSIAN_PAT',
];

function clearEnv() {
    for (const key of ENV_KEYS) delete process.env[key];
}

function setCloudEnv() {
    clearEnv();
    process.env.ATLASSIAN_JIRA_BASE_URL = 'https://team.atlassian.net';
    process.env.ATLASSIAN_DEPLOYMENT = 'cloud';
    process.env.ATLASSIAN_EMAIL = 'bot@example.com';
    process.env.ATLASSIAN_API_TOKEN = 'secret';
}

function jsonResponse(body) {
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

afterEach(() => {
    clearEnv();
    vi.unstubAllGlobals();
});

describe('jira commands', () => {
    it('registers non-browser REST commands', () => {
        for (const name of ['issue', 'search', 'comments', 'attachments', 'links']) {
            const cmd = getRegistry().get(`jira/${name}`);
            expect(cmd).toBeDefined();
            expect(cmd.browser).toBe(false);
            expect(cmd.strategy).toBe('public');
        }
    });

    it('normalizes a Cloud issue into agent-friendly context', async () => {
        setCloudEnv();
        vi.stubGlobal('fetch', vi.fn(async (url) => {
            expect(String(url)).toContain('/rest/api/3/issue/PROJ-1?');
            return jsonResponse({
                id: '10001',
                key: 'PROJ-1',
                fields: {
                    summary: 'Checkout fails',
                    issuetype: { name: 'Bug' },
                    status: { name: 'In Progress' },
                    priority: { name: 'High' },
                    labels: ['prod'],
                    description: {
                        type: 'doc',
                        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Payment fails' }] }],
                    },
                    comment: {
                        total: 1,
                        comments: [{
                            id: 'c1',
                            author: { displayName: 'Alice' },
                            created: '2026-05-01T00:00:00.000+0000',
                            body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Needs RCA' }] }] },
                        }],
                    },
                    attachment: [{ id: 'a1', filename: 'log.txt', mimeType: 'text/plain', size: 12, content: 'https://team.atlassian.net/secure/attachment/a1/log.txt' }],
                    issuelinks: [{ type: { name: 'Blocks' }, outwardIssue: { key: 'PROJ-2' } }],
                    fixVersions: [{ name: '1.2.3' }],
                    created: '2026-05-01T00:00:00.000+0000',
                    updated: '2026-05-02T00:00:00.000+0000',
                },
            });
        }));
        const cmd = getRegistry().get('jira/issue');
        const rows = await cmd.func({ key: 'proj-1' });
        expect(rows[0]).toMatchObject({
            key: 'PROJ-1',
            summary: 'Checkout fails',
            issueType: 'Bug',
            status: 'In Progress',
            labels: ['prod'],
            url: 'https://team.atlassian.net/browse/PROJ-1',
        });
        expect(rows[0].description.markdown).toBe('Payment fails');
        expect(rows[0].comments[0].markdown).toBe('Needs RCA');
        expect(rows[0].attachments[0].filename).toBe('log.txt');
        expect(rows[0].linkedIssues[0]).toEqual({ key: 'PROJ-2', type: 'Blocks', direction: 'outward' });
    });

    it('fails typed when Jira issue payload is missing stable issue identity', async () => {
        setCloudEnv();
        vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ fields: { summary: 'No key' } })));
        const cmd = getRegistry().get('jira/issue');
        await expect(cmd.func({ key: 'PROJ-1' })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('fails typed when Jira issue nested collections have malformed shapes', async () => {
        setCloudEnv();
        const cmd = getRegistry().get('jira/issue');
        vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
            id: '10001',
            key: 'PROJ-1',
            fields: {
                summary: 'Checkout fails',
                labels: [],
                comment: { total: 1, comments: { id: 'c1' } },
                attachment: [],
                issuelinks: [],
            },
        })));
        await expect(cmd.func({ key: 'PROJ-1' })).rejects.toBeInstanceOf(CommandExecutionError);

        vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
            id: '10001',
            key: 'PROJ-1',
            fields: {
                summary: 'Checkout fails',
                labels: [],
                comment: { total: 0, comments: [] },
                attachment: { id: 'a1' },
                issuelinks: [],
            },
        })));
        await expect(cmd.func({ key: 'PROJ-1' })).rejects.toBeInstanceOf(CommandExecutionError);

        vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
            id: '10001',
            key: 'PROJ-1',
            fields: {
                summary: 'Checkout fails',
                labels: [],
                comment: null,
                attachment: [],
                issuelinks: [],
            },
        })));
        await expect(cmd.func({ key: 'PROJ-1' })).rejects.toBeInstanceOf(CommandExecutionError);

        vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
            id: '10001',
            key: 'PROJ-1',
            fields: {
                summary: 'Checkout fails',
                labels: [],
                comment: { total: 0, comments: [] },
                attachment: null,
                issuelinks: [],
            },
        })));
        await expect(cmd.func({ key: 'PROJ-1' })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('rejects invalid Jira issue keys before remote requests', async () => {
        expect(() => jiraSharedTest.requireIssueKey('notakey')).toThrow(/Invalid Jira issue key/);
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const cmd = getRegistry().get('jira/issue');
        await expect(cmd.func({ key: 'notakey' })).rejects.toMatchObject({ code: 'ARGUMENT' });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('fetches full comments when issue inline comments are truncated', async () => {
        setCloudEnv();
        const fetchMock = vi.fn(async (url) => {
            const href = String(url);
            if (href.includes('/comment?')) {
                return jsonResponse({
                    comments: [
                        { id: 'c1', author: { displayName: 'Alice' }, created: '2026-05-01', body: 'one' },
                        { id: 'c2', author: { displayName: 'Bob' }, created: '2026-05-02', body: 'two' },
                    ],
                });
            }
            return jsonResponse({
                id: '10001',
                key: 'PROJ-1',
                fields: {
                    summary: 'Checkout fails',
                    labels: [],
                    comment: {
                        total: 2,
                        comments: [{ id: 'c1', author: { displayName: 'Alice' }, created: '2026-05-01', body: 'one' }],
                    },
                    attachment: [],
                    issuelinks: [],
                },
            });
        });
        vi.stubGlobal('fetch', fetchMock);
        const cmd = getRegistry().get('jira/issue');
        const rows = await cmd.func({ key: 'PROJ-1', 'comments-limit': 10 });
        expect(rows[0].comments.map((comment) => comment.id)).toEqual(['c1', 'c2']);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('uses Data Center search endpoint and payload', async () => {
        clearEnv();
        process.env.ATLASSIAN_JIRA_BASE_URL = 'https://jira.example.com';
        process.env.ATLASSIAN_DEPLOYMENT = 'datacenter';
        process.env.ATLASSIAN_USERNAME = 'bot';
        process.env.ATLASSIAN_PASSWORD = 'secret';
        const fetchMock = vi.fn(async (url, init) => {
            expect(String(url)).toBe('https://jira.example.com/rest/api/2/search');
            expect(init.method).toBe('POST');
            expect(JSON.parse(init.body)).toMatchObject({
                jql: 'project = PROJ',
                startAt: 0,
                maxResults: 5,
            });
            return jsonResponse({
                issues: [{
                    id: '1',
                    key: 'PROJ-1',
                    fields: {
                        summary: 'Task',
                        status: { name: 'Done' },
                        updated: '2026-05-03T00:00:00.000+0000',
                    },
                }],
            });
        });
        vi.stubGlobal('fetch', fetchMock);
        const cmd = getRegistry().get('jira/search');
        const rows = await cmd.func({ jql: 'project = PROJ', limit: 5 });
        expect(rows).toEqual([
            expect.objectContaining({ key: 'PROJ-1', summary: 'Task', status: 'Done' }),
        ]);
    });

    it('separates Jira search empty results from malformed search payloads', async () => {
        setCloudEnv();
        const cmd = getRegistry().get('jira/search');
        vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ issues: [] })));
        await expect(cmd.func({ jql: 'project = NONE' })).rejects.toBeInstanceOf(EmptyResultError);

        vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ values: [] })));
        await expect(cmd.func({ jql: 'project = PROJ' })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('maps rendered comments to Markdown', async () => {
        setCloudEnv();
        vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
            comments: [{
                id: 'c1',
                author: { displayName: 'Bob' },
                created: '2026-05-01',
                renderedBody: '<p>Fixed<br/>Ready for QA</p>',
            }],
        })));
        const cmd = getRegistry().get('jira/comments');
        const rows = await cmd.func({ key: 'PROJ-1', limit: 1 });
        expect(rows[0]).toMatchObject({ id: 'c1', author: 'Bob' });
        expect(rows[0].markdown).toContain('Fixed');
        expect(rows[0].markdown).toContain('Ready for QA');
    });

    it('fails typed when Jira comment rows lack stable comment ids', async () => {
        setCloudEnv();
        vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
            comments: [{ author: { displayName: 'Bob' }, created: '2026-05-01', body: 'body' }],
        })));
        const cmd = getRegistry().get('jira/comments');
        await expect(cmd.func({ key: 'PROJ-1', limit: 1 })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('separates no Jira attachments from malformed attachment payloads', async () => {
        setCloudEnv();
        const cmd = getRegistry().get('jira/attachments');
        vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ id: '1', key: 'PROJ-1', fields: { attachment: [] } })));
        await expect(cmd.func({ key: 'PROJ-1' })).rejects.toBeInstanceOf(EmptyResultError);

        vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ id: '1', key: 'PROJ-1', fields: {} })));
        await expect(cmd.func({ key: 'PROJ-1' })).rejects.toBeInstanceOf(CommandExecutionError);
    });
});
