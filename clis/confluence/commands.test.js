import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, afterEach, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import './page.js';
import './search.js';
import './create.js';
import './update.js';

const ENV_KEYS = [
    'ATLASSIAN_CONFLUENCE_BASE_URL',
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
    process.env.ATLASSIAN_CONFLUENCE_BASE_URL = 'https://team.atlassian.net/wiki';
    process.env.ATLASSIAN_DEPLOYMENT = 'cloud';
    process.env.ATLASSIAN_EMAIL = 'bot@example.com';
    process.env.ATLASSIAN_API_TOKEN = 'secret';
}

function jsonResponse(body) {
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

async function withTempMarkdown(markdown, fn) {
    const dir = await mkdtemp(join(tmpdir(), 'opencli-confluence-'));
    const file = join(dir, 'doc.md');
    await writeFile(file, markdown);
    try {
        return await fn(file);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}

afterEach(() => {
    clearEnv();
    vi.unstubAllGlobals();
});

describe('confluence commands', () => {
    it('registers expected REST commands', () => {
        for (const name of ['page', 'search', 'create', 'update']) {
            const cmd = getRegistry().get(`confluence/${name}`);
            expect(cmd).toBeDefined();
            expect(cmd.browser).toBe(false);
            expect(cmd.strategy).toBe('public');
        }
    });

    it('requires --execute before create performs remote writes', async () => {
        const cmd = getRegistry().get('confluence/create');
        await expect(cmd.func({ space: '123', title: 'Doc', file: 'doc.md' })).rejects.toThrow(/--execute/);
    });

    it('creates a Cloud page from Markdown storage', async () => {
        setCloudEnv();
        await withTempMarkdown('# RCA\n\n- Payment failed', async (file) => {
            const fetchMock = vi.fn(async (url, init) => {
                expect(String(url)).toBe('https://team.atlassian.net/wiki/api/v2/pages');
                const payload = JSON.parse(init.body);
                expect(payload).toMatchObject({ spaceId: '987', title: 'PROJ-1 RCA' });
                expect(payload.body.value).toContain('<h1>RCA</h1>');
                expect(payload.body.value.replace(/\s*\n\s*/g, '')).toContain('<li>Payment failed</li>');
                return jsonResponse({
                    id: '555',
                    title: 'PROJ-1 RCA',
                    status: 'current',
                    spaceId: '987',
                    version: { number: 1, createdAt: '2026-05-01T00:00:00Z' },
                    body: { storage: { value: '<h1>RCA</h1>' } },
                    _links: { webui: '/spaces/ENG/pages/555' },
                });
            });
            vi.stubGlobal('fetch', fetchMock);
            const cmd = getRegistry().get('confluence/create');
            const rows = await cmd.func({ space: '987', title: 'PROJ-1 RCA', file, representation: 'markdown', execute: true });
            expect(rows[0]).toMatchObject({ status: 'created', id: '555', title: 'PROJ-1 RCA', version: 1 });
            expect(rows[0].url).toBe('https://team.atlassian.net/wiki/spaces/ENG/pages/555');
        });
    });

    it('updates a page by incrementing the current version', async () => {
        setCloudEnv();
        await withTempMarkdown('Updated body', async (file) => {
            const fetchMock = vi.fn(async (url, init) => {
                if (init.method === 'GET') {
                    expect(String(url)).toBe('https://team.atlassian.net/wiki/api/v2/pages/555?body-format=storage');
                    return jsonResponse({
                        id: '555',
                        title: 'Existing',
                        status: 'current',
                        version: { number: 7 },
                        body: { storage: { value: '<p>Old</p>' } },
                    });
                }
                expect(init.method).toBe('PUT');
                const payload = JSON.parse(init.body);
                expect(payload.version).toMatchObject({ number: 8, message: 'Sync from Jira' });
                expect(payload.title).toBe('Existing');
                return jsonResponse({
                    id: '555',
                    title: 'Existing',
                    status: 'current',
                    version: { number: 8 },
                    body: { storage: { value: '<p>Updated body</p>' } },
                });
            });
            vi.stubGlobal('fetch', fetchMock);
            const cmd = getRegistry().get('confluence/update');
            const rows = await cmd.func({ id: '555', file, representation: 'markdown', 'version-message': 'Sync from Jira', execute: true });
            expect(rows[0]).toMatchObject({ status: 'updated', id: '555', version: 8 });
            expect(fetchMock).toHaveBeenCalledTimes(2);
        });
    });

    it('does not update a Confluence page when the current version is malformed', async () => {
        setCloudEnv();
        await withTempMarkdown('Updated body', async (file) => {
            const fetchMock = vi.fn(async (url, init) => {
                expect(init.method).toBe('GET');
                return jsonResponse({
                    id: '555',
                    title: 'Existing',
                    status: 'current',
                    body: { storage: { value: '<p>Old</p>' } },
                });
            });
            vi.stubGlobal('fetch', fetchMock);
            const cmd = getRegistry().get('confluence/update');
            await expect(cmd.func({ id: '555', file, representation: 'markdown', execute: true }))
                .rejects.toBeInstanceOf(CommandExecutionError);
            expect(fetchMock).toHaveBeenCalledTimes(1);
        });
    });

    it('searches with CQL scoped to a Data Center space', async () => {
        clearEnv();
        process.env.ATLASSIAN_CONFLUENCE_BASE_URL = 'https://conf.example.com/confluence';
        process.env.ATLASSIAN_DEPLOYMENT = 'datacenter';
        process.env.ATLASSIAN_PAT = 'pat';
        const fetchMock = vi.fn(async (url) => {
            const parsed = new URL(String(url));
            expect(parsed.searchParams.get('cql')).toBe('space = "ENG" and (type = page)');
            return jsonResponse({
                results: [{
                    content: {
                        id: '123',
                        type: 'page',
                        status: 'current',
                        title: 'Runbook',
                        space: { key: 'ENG' },
                        _links: { webui: '/display/ENG/Runbook' },
                    },
                    lastModified: '2026-05-02T00:00:00Z',
                }],
            });
        });
        vi.stubGlobal('fetch', fetchMock);
        const cmd = getRegistry().get('confluence/search');
        const rows = await cmd.func({ cql: 'type = page', space: 'ENG', limit: 10 });
        expect(rows[0]).toMatchObject({ id: '123', title: 'Runbook', spaceKey: 'ENG' });
        expect(rows[0].url).toBe('https://conf.example.com/confluence/display/ENG/Runbook');
    });

    it('separates Confluence search empty results from malformed search payloads', async () => {
        setCloudEnv();
        const cmd = getRegistry().get('confluence/search');
        vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ results: [] })));
        await expect(cmd.func({ cql: 'type = page', limit: 10 })).rejects.toBeInstanceOf(EmptyResultError);

        vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ items: [] })));
        await expect(cmd.func({ cql: 'type = page', limit: 10 })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('fails typed when Confluence page payload lacks stable page identity', async () => {
        setCloudEnv();
        vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ title: 'Missing id', version: { number: 1 } })));
        const cmd = getRegistry().get('confluence/page');
        await expect(cmd.func({ id: '555' })).rejects.toBeInstanceOf(CommandExecutionError);
    });
});
