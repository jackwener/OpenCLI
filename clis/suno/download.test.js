import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    ensureSunoSession: vi.fn(),
    downloadSunoClip: vi.fn(),
}));

vi.mock('./utils.js', () => ({
    STUDIO_API: 'https://studio-api-prod.suno.com',
    SUNO_DOMAIN: 'suno.com',
    SUNO_URL: 'https://suno.com',
    ensureSunoSession: mocks.ensureSunoSession,
    downloadSunoClip: mocks.downloadSunoClip,
    normalizeBooleanFlag: (value, fallback = false) => {
        if (typeof value === 'boolean') return value;
        if (value == null || value === '') return fallback;
        const s = String(value).trim().toLowerCase();
        return s === 'true' || s === '1' || s === 'yes' || s === 'on';
    },
    parseFormats: (value) => {
        if (!value) return ['mp3', 'metadata'];
        return String(value).split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    },
    resolveSunoOutputDir: (value) => value || '/tmp/suno-test',
    unwrapEvaluateResult: (value) => value && typeof value === 'object' && 'session' in value && 'data' in value ? value.data : value,
}));

const { downloadCommand } = await import('./download.js');

const okSession = { ok: true, deviceId: 'device-uuid' };
const okCompleteClip = { id: '11111111-2222-3333-4444-555555555555', status: 'complete', title: 'Probe', audio_url: 'https://cdn1.suno.ai/x.mp3' };

function createPageWithFeed(clips) {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue({ ok: true, clips }),
    };
}

beforeEach(() => {
    vi.restoreAllMocks();
    mocks.ensureSunoSession.mockReset().mockResolvedValue(okSession);
    mocks.downloadSunoClip.mockReset().mockResolvedValue({
        slug: 'probe',
        written: [{ format: 'mp3', file: '/tmp/probe.mp3', ok: true }, { format: 'metadata', file: '/tmp/probe.json', ok: true }],
    });
});

describe('suno download argument validation', () => {
    it('parses bare UUID clip ids', async () => {
        const id = okCompleteClip.id;
        await downloadCommand.func(createPageWithFeed([okCompleteClip]), { clip: id, formats: 'mp3' });
        expect(mocks.downloadSunoClip).toHaveBeenCalledWith(expect.anything(), okCompleteClip, '/tmp/suno-test', ['mp3'], 'device-uuid');
    });

    it('extracts UUID from a full suno.com/song/<id> URL', async () => {
        const id = okCompleteClip.id;
        await downloadCommand.func(createPageWithFeed([okCompleteClip]), { clip: `https://suno.com/song/${id}`, formats: 'mp3' });
        expect(mocks.downloadSunoClip).toHaveBeenCalledWith(expect.anything(), okCompleteClip, '/tmp/suno-test', ['mp3'], 'device-uuid');
    });

    it('rejects off-domain URLs even if they contain a UUID', async () => {
        const id = okCompleteClip.id;
        await expect(downloadCommand.func(createPageWithFeed([]), { clip: `https://evil.example/song/${id}`, formats: 'mp3' })).rejects.toMatchObject({
            code: 'ARGUMENT',
            message: expect.stringContaining('Invalid clip-id'),
        });
    });

    it('rejects non-UUID clip ids with ArgumentError', async () => {
        await expect(downloadCommand.func(createPageWithFeed([]), { clip: 'not-a-uuid', formats: 'mp3' })).rejects.toMatchObject({
            code: 'ARGUMENT',
            message: expect.stringContaining('Invalid clip-id'),
        });
    });
});

describe('suno download lookup and status handling', () => {
    it('returns EmptyResultError when feed/v3 does not contain the clip', async () => {
        await expect(downloadCommand.func(createPageWithFeed([]), { clip: okCompleteClip.id, formats: 'mp3' })).rejects.toMatchObject({
            code: 'EMPTY_RESULT',
            hint: expect.stringContaining('not found'),
        });
    });

    it('unwraps Browser Bridge envelopes around feed lookup results', async () => {
        const page = createPageWithFeed([]);
        page.evaluate.mockResolvedValueOnce({ session: 'browser:default', data: { ok: true, clips: [okCompleteClip] } });
        await downloadCommand.func(page, { clip: okCompleteClip.id, formats: 'mp3' });
        expect(mocks.downloadSunoClip).toHaveBeenCalledWith(expect.anything(), okCompleteClip, '/tmp/suno-test', ['mp3'], 'device-uuid');
    });

    it('fails typed when feed/v3 returns malformed clips payload', async () => {
        const page = createPageWithFeed([]);
        page.evaluate.mockResolvedValueOnce({ ok: true, clips: null });
        await expect(downloadCommand.func(page, { clip: okCompleteClip.id, formats: 'mp3' })).rejects.toMatchObject({
            code: 'COMMAND_EXEC',
            message: expect.stringContaining('malformed clips payload'),
        });
    });

    it('refuses to download when the clip is still streaming/queued', async () => {
        await expect(downloadCommand.func(createPageWithFeed([{ ...okCompleteClip, status: 'streaming' }]), { clip: okCompleteClip.id, formats: 'mp3' })).rejects.toMatchObject({
            code: 'COMMAND_EXEC',
            message: expect.stringContaining('not complete yet'),
        });
    });
});

describe('suno download paid-format guard', () => {
    it('skips wav by default and surfaces the skip in the result row', async () => {
        const out = await downloadCommand.func(createPageWithFeed([okCompleteClip]), {
            clip: okCompleteClip.id,
            formats: 'mp3,wav,metadata',
        });
        expect(mocks.downloadSunoClip).toHaveBeenCalledWith(expect.anything(), okCompleteClip, '/tmp/suno-test', ['mp3', 'metadata'], 'device-uuid');
        expect(out[0].files).toContain('skipped(needs --confirm-paid):wav');
    });

    it('rejects requests where every requested format is paid and unconfirmed', async () => {
        await expect(downloadCommand.func(createPageWithFeed([okCompleteClip]), {
            clip: okCompleteClip.id,
            formats: 'wav',
        })).rejects.toMatchObject({
            code: 'ARGUMENT',
            message: expect.stringContaining('All requested formats require'),
        });
        expect(mocks.downloadSunoClip).not.toHaveBeenCalled();
    });

    it('includes wav when --confirm-paid is true', async () => {
        await downloadCommand.func(createPageWithFeed([okCompleteClip]), {
            clip: okCompleteClip.id,
            formats: 'mp3,wav',
            'confirm-paid': true,
        });
        expect(mocks.downloadSunoClip).toHaveBeenCalledWith(expect.anything(), okCompleteClip, '/tmp/suno-test', ['mp3', 'wav'], 'device-uuid');
    });

    it('fails typed when selected formats write no files', async () => {
        mocks.downloadSunoClip.mockResolvedValue({ slug: 'probe', written: [{ format: 'mp3', file: null, ok: false, reason: 'HTTP 500' }] });
        await expect(downloadCommand.func(createPageWithFeed([okCompleteClip]), {
            clip: okCompleteClip.id,
            formats: 'mp3',
        })).rejects.toMatchObject({
            code: 'COMMAND_EXEC',
            message: expect.stringContaining('wrote no files'),
        });
    });
});
