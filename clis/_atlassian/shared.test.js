import { describe, expect, it, afterEach, vi } from 'vitest';
import { __test__ } from './shared.js';
import { CommandExecutionError } from '@jackwener/opencli/errors';

const ENV_KEYS = [
    'ATLASSIAN_CONFLUENCE_BASE_URL',
    'ATLASSIAN_DEPLOYMENT',
    'ATLASSIAN_EMAIL',
    'ATLASSIAN_API_TOKEN',
    'ATLASSIAN_PAT',
    'ATLASSIAN_JIRA_BASE_URL',
];

function clearEnv() {
    for (const key of ENV_KEYS) delete process.env[key];
}

afterEach(() => {
    clearEnv();
    vi.unstubAllGlobals();
});

describe('atlassian shared helpers', () => {
    it('infers Confluence Cloud and appends /wiki', () => {
        clearEnv();
        process.env.ATLASSIAN_CONFLUENCE_BASE_URL = 'https://example.atlassian.net';
        process.env.ATLASSIAN_EMAIL = 'bot@example.com';
        process.env.ATLASSIAN_API_TOKEN = 'secret';
        const config = __test__.getConfluenceConfig();
        expect(config.deployment).toBe('cloud');
        expect(config.baseUrl).toBe('https://example.atlassian.net/wiki');
        expect(config.authHeaders.Authorization).toMatch(/^Basic /);
    });

    it('uses Data Center PAT as bearer auth', () => {
        clearEnv();
        process.env.ATLASSIAN_JIRA_BASE_URL = 'https://jira.example.com';
        process.env.ATLASSIAN_DEPLOYMENT = 'datacenter';
        process.env.ATLASSIAN_PAT = 'pat-123';
        const config = __test__.getJiraConfig();
        expect(config.deployment).toBe('datacenter');
        expect(config.authHeaders.Authorization).toBe('Bearer pat-123');
    });

    it('converts Jira ADF to Markdown', () => {
        const markdown = __test__.adfToMarkdown({
            type: 'doc',
            content: [
                {
                    type: 'paragraph',
                    content: [
                        { type: 'text', text: 'Broken ', marks: [{ type: 'strong' }] },
                        { type: 'text', text: 'checkout', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] },
                    ],
                },
                {
                    type: 'bulletList',
                    content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'retry payment' }] }] }],
                },
            ],
        });
        expect(markdown).toContain('**Broken **');
        expect(markdown).toContain('[checkout](https://example.com)');
        expect(markdown).toContain('- retry payment');
    });

    it('escapes pipe characters inside ADF table cells', () => {
        const markdown = __test__.adfToMarkdown({
            type: 'doc',
            content: [{
                type: 'table',
                content: [
                    {
                        type: 'tableRow',
                        content: [
                            { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Service' }] }] },
                            { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Notes' }] }] },
                        ],
                    },
                    {
                        type: 'tableRow',
                        content: [
                            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'payments' }] }] },
                            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a | b' }] }] },
                        ],
                    },
                ],
            }],
        });
        expect(markdown).toContain('Service | Notes');
        expect(markdown).toContain('--- | ---');
        expect(markdown).toContain('payments | a \\| b');
    });

    it('converts nested HTML to Markdown through the shared Turndown converter', () => {
        const markdown = __test__.htmlToMarkdown('<ul><li><strong>Root</strong><ul><li>Child</li></ul></li></ul><table><tr><th>A</th></tr><tr><td>B</td></tr></table>');
        expect(markdown).toContain('**Root**');
        expect(markdown).toContain('Child');
        expect(markdown).toContain('A');
        expect(markdown).toContain('B');
    });

    it('converts Markdown to conservative Confluence storage XHTML', () => {
        const storage = __test__.markdownToConfluenceStorage([
            '# RCA',
            '',
            '- Impacted checkout',
            '',
            '| Service | Status |',
            '| --- | --- |',
            '| payments | fixed |',
        ].join('\n'));
        expect(storage).toContain('<h1>RCA</h1>');
        expect(storage).toContain('<ul>');
        expect(storage).toContain('<table>');
        expect(storage).toContain('<td>fixed</td>');
    });

    it('preserves nested Markdown lists in Confluence storage XHTML', () => {
        const storage = __test__.markdownToConfluenceStorage([
            '- Parent',
            '  - Child',
            '- Next',
        ].join('\n'));
        const compact = storage.replace(/\s*\n\s*/g, '');
        expect(compact).toContain('<ul><li>Parent<ul><li>Child</li></ul></li><li>Next</li></ul>');
    });

    it('sends JSON requests with configured auth headers', async () => {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const data = await __test__.atlassianRequest({
            product: 'jira',
            baseUrl: 'https://jira.example.com',
            deployment: 'datacenter',
            authHeaders: { Authorization: 'Bearer token' },
        }, '/rest/api/2/myself', { label: 'jira myself' });
        expect(data).toEqual({ ok: true });
        expect(fetchMock.mock.calls[0][0]).toBe('https://jira.example.com/rest/api/2/myself');
        expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer token');
    });

    it('maps auth and rate-limit responses to typed errors', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: 'bad token' }), { status: 401 })));
        await expect(__test__.atlassianRequest({
            product: 'jira',
            baseUrl: 'https://jira.example.com',
            deployment: 'datacenter',
            authHeaders: { Authorization: 'Bearer token' },
        }, '/rest/api/2/myself', { label: 'jira myself' })).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });

        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: 'slow down' }), { status: 429 })));
        await expect(__test__.atlassianRequest({
            product: 'jira',
            baseUrl: 'https://jira.example.com',
            deployment: 'datacenter',
            authHeaders: { Authorization: 'Bearer token' },
        }, '/rest/api/2/myself', { label: 'jira myself' })).rejects.toMatchObject({ code: 'COMMAND_EXEC' });
    });

    it('fails typed when a successful Atlassian REST response is not JSON', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>login</html>', { status: 200, headers: { 'content-type': 'text/html' } })));
        await expect(__test__.atlassianRequest({
            product: 'jira',
            baseUrl: 'https://jira.example.com',
            deployment: 'datacenter',
            authHeaders: { Authorization: 'Bearer token' },
        }, '/rest/api/2/myself', { label: 'jira myself' })).rejects.toBeInstanceOf(CommandExecutionError);
    });
});
