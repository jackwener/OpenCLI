import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import './rfc.js';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('rfc rfc adapter', () => {
    const cmd = getRegistry().get('rfc/rfc');

    it('rejects malformed RFC numbers before fetching', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        await expect(cmd.func({ number: 'abc' })).rejects.toThrow(ArgumentError);
        await expect(cmd.func({ number: 0 })).rejects.toThrow(ArgumentError);
        await expect(cmd.func({ number: -5 })).rejects.toThrow(ArgumentError);
        await expect(cmd.func({ number: 1000000 })).rejects.toThrow(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('maps HTTP 404 to EmptyResultError', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not found', { status: 404 })));
        await expect(cmd.func({ number: 999998 })).rejects.toThrow(EmptyResultError);
    });

    it('maps HTTP 429 to CommandExecutionError', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('rate limited', { status: 429 })));
        await expect(cmd.func({ number: 9000 })).rejects.toThrow(CommandExecutionError);
    });

    it('flattens authors + group, normalises space-separated date, and emits rfcEditorUrl', async () => {
        const doc = {
            name: 'rfc9000',
            title: 'QUIC: A UDP-Based Multiplexed and Secure Transport',
            state: 'Published',
            std_level: 'Proposed Standard',
            group: { name: 'QUIC', type: 'WG' },
            pages: 151,
            time: '2022-02-19 08:46:51',
            authors: [
                { name: 'Jana Iyengar', email: 'jri@example' },
                { name: 'Martin Thomson', email: 'mt@example' },
            ],
            abstract: 'This document defines QUIC.',
        };
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(doc), { status: 200 })));

        const rows = await cmd.func({ number: 9000 });
        expect(rows[0]).toMatchObject({
            rfc: 9000,
            title: 'QUIC: A UDP-Based Multiplexed and Secure Transport',
            stdLevel: 'Proposed Standard',
            group: 'QUIC',
            groupType: 'WG',
            pages: 151,
            published: '2022-02-19',
            authors: 'Jana Iyengar, Martin Thomson',
            rfcEditorUrl: 'https://www.rfc-editor.org/rfc/rfc9000',
            url: 'https://datatracker.ietf.org/doc/rfc9000/',
        });
    });

    it('accepts "rfc<N>" prefix as a courtesy', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
            name: 'rfc791', title: 'Internet Protocol', authors: [], group: {},
        }), { status: 200 })));
        const rows = await cmd.func({ number: 'rfc791' });
        expect(rows[0].rfc).toBe(791);
    });
});
