import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRegistry } from '@jackwener/opencli/registry';
import './transcript.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const transcriptSource = readFileSync(resolve(__dirname, 'transcript.js'), 'utf8');

function createPageMock(captionUrl) {
    const page = {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn(),
    };
    page.evaluate
        .mockResolvedValueOnce({
        captionUrl,
        language: 'en',
        kind: 'manual',
        available: ['en'],
        requestedLang: null,
        langMatched: false,
        langPrefixMatched: false,
    })
        .mockResolvedValue([{ start: 1, end: 3, text: 'hello & world' }]);
    return page;
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('youtube transcript source contract', () => {
    it('gets caption tracks from watch page bootstrap data, not Android InnerTube', () => {
        expect(transcriptSource).toContain("fetch('/watch?v='");
        expect(transcriptSource).toContain("extractJsonAssignmentFromHtml(html, 'ytInitialPlayerResponse')");
        expect(transcriptSource).toContain('playerCaptionsTracklistRenderer');
        expect(transcriptSource).not.toContain('/youtubei/v1/player');
        expect(transcriptSource).not.toContain("clientName: 'ANDROID'");
    });

    it('normalizes caption URL to request srv3 XML format', () => {
        expect(transcriptSource).toContain('fmt=srv3');
    });

    it('checks HTTP status before reading caption response body', () => {
        expect(transcriptSource).toContain('resp.ok');
    });
});

describe('youtube transcript caption fetch', () => {
    const command = getRegistry().get('youtube/transcript');

    it('requests srv3 when the caption track URL has no explicit format', async () => {
        const page = createPageMock('https://www.youtube.com/api/timedtext?v=abc&lang=en');

        const rows = await command.func(page, { url: 'abc', mode: 'raw' });

        expect(page.evaluate.mock.calls[1][0]).toContain('const primaryUrl = "https://www.youtube.com/api/timedtext?v=abc&lang=en&fmt=srv3"');
        expect(page.evaluate.mock.calls[1][0]).toContain('const originalUrl = "https://www.youtube.com/api/timedtext?v=abc&lang=en"');
        expect(rows).toEqual([{ index: 1, start: '1.00s', end: '3.00s', text: 'hello & world' }]);
    });

    it('does not override an existing caption format', async () => {
        const page = createPageMock('https://www.youtube.com/api/timedtext?v=abc&lang=en&fmt=vtt');

        await command.func(page, { url: 'abc', mode: 'raw' });

        expect(page.evaluate.mock.calls[1][0]).toContain('const primaryUrl = "https://www.youtube.com/api/timedtext?v=abc&lang=en&fmt=vtt"');
        expect(page.evaluate.mock.calls[1][0]).toContain('const originalUrl = "https://www.youtube.com/api/timedtext?v=abc&lang=en&fmt=vtt"');
    });

    it('falls back to the original URL only after an empty successful srv3 response', async () => {
        const page = createPageMock('https://www.youtube.com/api/timedtext?v=abc&lang=en');

        await command.func(page, { url: 'abc', mode: 'raw' });

        const script = page.evaluate.mock.calls[1][0];
        expect(script).toContain('if (!result.xml.length && originalUrl !== primaryUrl)');
        expect(script).toContain('result = await fetchCaptionXml(originalUrl)');
        expect(script).toContain('if (result.error) {');
    });

    it('fails typed on caption HTTP errors instead of falling back silently', async () => {
        const page = createPageMock('https://www.youtube.com/api/timedtext?v=abc&lang=en');
        page.evaluate.mockReset();
        page.evaluate
            .mockResolvedValueOnce({
            captionUrl: 'https://www.youtube.com/api/timedtext?v=abc&lang=en',
            language: 'en',
            kind: 'manual',
            available: ['en'],
            requestedLang: null,
            langMatched: false,
            langPrefixMatched: false,
        })
            .mockResolvedValueOnce({ error: 'Caption URL returned HTTP 503' });

        await expect(command.func(page, { url: 'abc', mode: 'raw' })).rejects.toMatchObject({
            code: 'COMMAND_EXEC',
            message: expect.stringContaining('HTTP 503'),
        });
    });
});
