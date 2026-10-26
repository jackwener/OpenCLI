import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './transcript.js';

function makePage({ evaluateImpl } = {}) {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate: evaluateImpl || vi.fn().mockResolvedValue([
            { start: 0, end: 1.5, text: 'Hello world' },
            { start: 1.5, end: 3.0, text: 'Second sentence' },
        ]),
    };
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('youtube transcript adapter', () => {
    it('is registered in registry with expected flags', () => {
        const cmd = getRegistry().get('youtube/transcript');
        expect(cmd).toBeDefined();
        expect(cmd.site).toBe('youtube');
        expect(cmd.name).toBe('transcript');
        expect(cmd.args.map(a => a.name)).toEqual(['url', 'lang', 'mode']);
    });

    it('formats raw mode with index and suffixed seconds', async () => {
        const page = makePage({
            evaluateImpl: vi.fn().mockResolvedValue([
                { start: 0, end: 1.5, text: 'First line' },
                { start: 1.5, end: 3.2, text: 'Second line' },
            ]),
        });

        const rows = await getRegistry().get('youtube/transcript').func(page, {
            url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
            mode: 'raw',
        });

        expect(rows).toEqual([
            { index: 1, start: '0.00s', end: '1.50s', text: 'First line' },
            { index: 2, start: '1.50s', end: '3.20s', text: 'Second line' },
        ]);
        expect(page.goto).toHaveBeenCalledWith('https://www.youtube.com/watch?v=dQw4w9WgXcQ', { waitUntil: 'none' });
    });

    it('executes evaluate script without syntax or reference errors', async () => {
        let scriptExecuted = false;
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn(async (script) => {
                scriptExecuted = true;
                // Evaluate script definition inside mock window context
                const previousWindow = globalThis.window;
                const previousFetch = globalThis.fetch;
                const previousDoc = globalThis.document;

                globalThis.window = {
                    ytcfg: {
                        data_: { INNERTUBE_API_KEY: 'mock-key' },
                    },
                };
                globalThis.document = {
                    getElementById: vi.fn().mockReturnValue(null),
                };
                globalThis.fetch = vi.fn().mockImplementation(async (url) => {
                    if (String(url).includes('/youtubei/v1/player')) {
                        return {
                            ok: true,
                            json: async () => ({
                                captions: {
                                    playerCaptionsTracklistRenderer: {
                                        captionTracks: [
                                            { baseUrl: 'https://www.youtube.com/api/timedtext?v=test', languageCode: 'en' },
                                        ],
                                    },
                                },
                            }),
                        };
                    }
                    if (String(url).includes('/api/timedtext')) {
                        return {
                            ok: true,
                            text: async () => JSON.stringify({
                                events: [
                                    { tStartMs: 0, dDurationMs: 1500, segs: [{ utf8: 'Fetched via innertube' }] },
                                ],
                            }),
                        };
                    }
                    return { ok: false };
                });

                try {
                    return await eval(script);
                } finally {
                    globalThis.window = previousWindow;
                    globalThis.fetch = previousFetch;
                    globalThis.document = previousDoc;
                }
            }),
        };

        const rows = await getRegistry().get('youtube/transcript').func(page, {
            url: 'https://www.youtube.com/watch?v=testVideo123',
            mode: 'raw',
        });

        expect(scriptExecuted).toBe(true);
        expect(rows).toEqual([
            { index: 1, start: '0.00s', end: '1.50s', text: 'Fetched via innertube' },
        ]);
    });
});
