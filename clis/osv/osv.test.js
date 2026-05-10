import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import './vulnerability.js';
import './query.js';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('osv vulnerability adapter', () => {
    const cmd = getRegistry().get('osv/vulnerability');

    it('rejects empty / malformed id before fetching', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        await expect(cmd.func({ id: '' })).rejects.toThrow(ArgumentError);
        await expect(cmd.func({ id: 'has spaces' })).rejects.toThrow(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('maps HTTP 404 to EmptyResultError', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not found', { status: 404 })));
        await expect(cmd.func({ id: 'GHSA-aaaa-bbbb-cccc' })).rejects.toThrow(EmptyResultError);
    });

    it('returns flattened affected packages with severity from database_specific', async () => {
        const vuln = {
            id: 'GHSA-29mw-wpgm-hmr9',
            summary: 'ReDoS in lodash',
            aliases: ['CVE-2020-28500'],
            published: '2022-01-06T20:30:46Z',
            modified: '2025-09-29T21:12:31.102523Z',
            database_specific: { severity: 'MODERATE', cwe_ids: ['CWE-1333', 'CWE-400'] },
            severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/...' }],
            affected: [
                { package: { name: 'lodash', ecosystem: 'npm' } },
                { package: { name: 'lodash-rails', ecosystem: 'RubyGems' } },
            ],
            references: [{ url: 'https://example' }],
        };
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(vuln), { status: 200 })));

        const rows = await cmd.func({ id: 'GHSA-29mw-wpgm-hmr9' });
        expect(rows).toEqual([expect.objectContaining({
            id: 'GHSA-29mw-wpgm-hmr9',
            severity: 'MODERATE',
            aliases: 'CVE-2020-28500',
            affectedPackages: 'npm:lodash, RubyGems:lodash-rails',
            cwes: 'CWE-1333, CWE-400',
            referenceCount: 1,
            modified: '2025-09-29T21:12:31Z',
        })]);
    });
});

describe('osv query adapter', () => {
    const cmd = getRegistry().get('osv/query');

    it('rejects bad ecosystem and bad limit before fetching', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        await expect(cmd.func({ package: 'lodash', ecosystem: 'foo', limit: 5 })).rejects.toThrow(ArgumentError);
        await expect(cmd.func({ package: 'django', ecosystem: 'pypi', limit: 5 })).rejects.toThrow(ArgumentError);
        await expect(cmd.func({ package: 'lodash', ecosystem: 'npm', limit: 0 })).rejects.toThrow(ArgumentError);
        await expect(cmd.func({ package: '', ecosystem: 'npm', limit: 5 })).rejects.toThrow(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('maps HTTP 429 to CommandExecutionError', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('rate limited', { status: 429 })));
        await expect(cmd.func({ package: 'lodash', ecosystem: 'npm', limit: 5 })).rejects.toThrow(CommandExecutionError);
    });

    it('throws EmptyResultError when no vulns reported', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 })));
        await expect(cmd.func({ package: 'lodash', ecosystem: 'npm', limit: 5 })).rejects.toThrow(EmptyResultError);
    });

    it('sorts by published date descending and rows have id round-tripable into osv vulnerability', async () => {
        const body = {
            vulns: [
                { id: 'GHSA-old', summary: 'old', published: '2020-01-01T00:00:00Z', affected: [{ package: { name: 'django', ecosystem: 'PyPI' } }] },
                { id: 'GHSA-new', summary: 'new', published: '2026-01-01T00:00:00Z', affected: [{ package: { name: 'django', ecosystem: 'PyPI' } }] },
            ],
        };
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 })));

        const rows = await cmd.func({ package: 'django', ecosystem: 'PyPI', limit: 5 });
        expect(rows[0]).toMatchObject({ rank: 1, id: 'GHSA-new', published: '2026-01-01T00:00:00Z' });
        expect(rows[1]).toMatchObject({ rank: 2, id: 'GHSA-old' });
        expect(rows[0].url).toBe('https://osv.dev/vulnerability/GHSA-new');
    });
});
