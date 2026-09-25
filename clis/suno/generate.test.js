import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    ensureSunoSession: vi.fn(),
    checkSunoCaptcha: vi.fn(),
    submitSunoGeneration: vi.fn(),
    pollSunoClips: vi.fn(),
    downloadSunoClip: vi.fn(),
}));

vi.mock('./utils.js', () => ({
    DEFAULT_SUNO_MODEL: 'v6',
    SUNO_DOMAIN: 'suno.com',
    SUNO_MODELS: ['v6', 'v6-wild', 'v6-mini'],
    SUNO_URL: 'https://suno.com',
    ensureSunoSession: mocks.ensureSunoSession,
    checkSunoCaptcha: mocks.checkSunoCaptcha,
    submitSunoGeneration: mocks.submitSunoGeneration,
    pollSunoClips: mocks.pollSunoClips,
    downloadSunoClip: mocks.downloadSunoClip,
    clampSlider: (value, _label, def) => (value === undefined || value === '' || value === null ? def : Number(value)),
    normalizeBooleanFlag: (value, fallback = false) => {
        if (typeof value === 'boolean') return value;
        if (value == null || value === '') return fallback;
        const s = String(value).trim().toLowerCase();
        return s === 'true' || s === '1' || s === 'yes' || s === 'on';
    },
    parseFormats: (value) => {
        if (!value) return ['mp3', 'metadata'];
        const raw = Array.isArray(value) ? value.join(',') : String(value);
        return raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    },
    requirePositiveInt: (value) => {
        const n = Number(value);
        if (!Number.isInteger(n) || n < 1) throw new Error('positive int required');
        return n;
    },
    resolveSunoOutputDir: (value) => value || '/tmp/suno-test',
}));

const { generateCommand } = await import('./generate.js');

function createPage() {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        click: vi.fn().mockResolvedValue({ clicked: true }),
        evaluate: vi.fn(async js => js.includes('simple: document.querySelector')
            ? { simple: false, advanced: false } : undefined),
    };
}

const okSession = {
    ok: true,
    planId: '3eaebef3-ef46-446a-931c-3d50cd1514f1',
    planKey: 'pro',
    totalCreditsAvailable: 2000,
    breakdown: { pack: 0, purchasedPacks: 0, monthlyRemaining: 2000, monthlyLimit: 2500, monthlyUsed: 500 },
    deviceId: 'device-uuid',
    models: [{ name: 'v6', externalKey: 'chirp-hawk', canUse: true, isDefault: true },
        { name: 'v6-wild', externalKey: 'chirp-hawk-wild', canUse: true, isDefault: false },
        { name: 'v6-mini', externalKey: 'chirp-goose', canUse: true, isDefault: false }],
};
const okCaptcha = { ok: true, required: false };
const okSubmission = { id: 'batch-id', clips: [{ id: 'clip-a-id', status: 'submitted' }, { id: 'clip-b-id', status: 'submitted' }] };
const okClips = [
    { id: 'clip-a-id', status: 'complete', title: 'Clip A', audio_url: 'https://cdn1.suno.ai/clip-a-id.mp3' },
    { id: 'clip-b-id', status: 'complete', title: 'Clip B', audio_url: 'https://cdn1.suno.ai/clip-b-id.mp3' },
];

beforeEach(() => {
    vi.restoreAllMocks();
    mocks.ensureSunoSession.mockReset().mockResolvedValue(okSession);
    mocks.checkSunoCaptcha.mockReset().mockResolvedValue(okCaptcha);
    mocks.submitSunoGeneration.mockReset().mockResolvedValue(okSubmission);
    mocks.pollSunoClips.mockReset().mockResolvedValue(okClips);
    mocks.downloadSunoClip.mockReset().mockResolvedValue({ slug: 'clip', written: [{ format: 'mp3', file: '/tmp/x.mp3', ok: true }, { format: 'metadata', file: '/tmp/x.json', ok: true }] });
});

describe('suno generate argument validation', () => {
    it('rejects calls with neither a Simple prompt nor --lyrics', async () => {
        await expect(generateCommand.func(createPage(), { sd: true, timeout: 60 })).rejects.toMatchObject({
            code: 'ARGUMENT',
            message: expect.stringContaining('Either provide a Simple-mode prompt'),
        });
    });

    it('rejects --tags / --negative-tags in Simple mode', async () => {
        await expect(generateCommand.func(createPage(), { prompt: 'foo', tags: 'lo-fi', sd: true, timeout: 60 })).rejects.toMatchObject({
            code: 'ARGUMENT',
            message: expect.stringContaining('only apply in Custom mode'),
        });
    });

    it('rejects unsupported --model values', async () => {
        await expect(generateCommand.func(createPage(), { prompt: 'foo', model: 'chirp-vNEXT', sd: true, timeout: 60 })).rejects.toMatchObject({
            code: 'ARGUMENT',
            message: expect.stringContaining('Unsupported --model'),
        });
    });

    it('refuses to submit when planId is null (free-tier without resolved user_tier) (#1704)', async () => {
        mocks.ensureSunoSession.mockResolvedValue({ ...okSession, planId: null, planKey: 'free' });
        await expect(generateCommand.func(createPage(), { prompt: 'foo', sd: true, timeout: 60 })).rejects.toMatchObject({
            code: 'COMMAND_EXEC',
            message: expect.stringContaining('plan id'),
        });
        expect(mocks.submitSunoGeneration).not.toHaveBeenCalled();
    });

    it('refuses to submit when credits are below the per-song minimum', async () => {
        mocks.ensureSunoSession.mockResolvedValue({ ...okSession, totalCreditsAvailable: 5, breakdown: { ...okSession.breakdown, monthlyRemaining: 5 } });
        await expect(generateCommand.func(createPage(), { prompt: 'foo', sd: true, timeout: 60 })).rejects.toMatchObject({
            code: 'COMMAND_EXEC',
            message: expect.stringContaining('needs ~10 credits'),
        });
        expect(mocks.submitSunoGeneration).not.toHaveBeenCalled();
    });

    it('rejects lyrics plus instrumental before native submission', async () => {
        mocks.checkSunoCaptcha.mockResolvedValue({ ok: true, required: true });
        await expect(generateCommand.func(createPage(), { lyrics: '[Verse] foo', instrumental: true, sd: true, timeout: 60 })).rejects.toMatchObject({
            code: 'ARGUMENT',
            message: expect.stringContaining('cannot combine nonempty lyrics'),
        });
        expect(mocks.submitSunoGeneration).not.toHaveBeenCalled();
    });

    it('uses Create instead of the direct API when captcha pre-flight fails', async () => {
        mocks.checkSunoCaptcha.mockResolvedValue({ ok: false, status: 500 });
        const page = createPage();
        await expect(generateCommand.func(page, { prompt: 'foo', sd: true, timeout: 60 })).rejects.toMatchObject({ code: 'COMMAND_EXEC' });
        expect(page.goto).toHaveBeenCalledWith('https://suno.com/create');
        expect(mocks.submitSunoGeneration).not.toHaveBeenCalled();
    });
    it('skips the captcha probe when --via-ui is explicit', async () => {
        const page = createPage();
        await expect(generateCommand.func(page, { prompt: 'foo', 'via-ui': true, sd: true, timeout: 60 })).rejects.toMatchObject({ code: 'COMMAND_EXEC' });
        expect(mocks.checkSunoCaptcha).not.toHaveBeenCalled();
        expect(page.goto).toHaveBeenCalledWith('https://suno.com/create');
        expect(mocks.submitSunoGeneration).not.toHaveBeenCalled();
    });
});

describe('suno generate Simple mode payload', () => {
    it('routes the positional prompt through `description` (Simple mode)', async () => {
        await generateCommand.func(createPage(), { prompt: 'lo-fi study beat', sd: true, timeout: 60 });
        expect(mocks.submitSunoGeneration).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            mode: 'simple',
            description: 'lo-fi study beat',
            lyrics: '',
            tags: '',
            negativeTags: '',
            userTier: okSession.planId,
            deviceId: okSession.deviceId,
        }));
    });
    it('uses the available free-plan v6-mini model when it is the account default', async () => {
        mocks.ensureSunoSession.mockResolvedValue({ ...okSession, models: [
            { name: 'v6', externalKey: 'chirp-hawk', canUse: false, isDefault: false },
            { name: 'v6-mini', externalKey: 'chirp-goose', canUse: true, isDefault: true },
        ] });
        await generateCommand.func(createPage(), { prompt: 'short melody', sd: true, timeout: 60 });
        expect(mocks.submitSunoGeneration).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            model: 'chirp-goose',
            modelName: 'v6-mini',
        }));
    });
});

describe('suno generate Custom mode payload', () => {
    it('routes --lyrics through `lyrics` and --tags through `tags`', async () => {
        await generateCommand.func(createPage(), {
            lyrics: '[Verse]\\nfoo',
            tags: 'synthwave, 95 BPM',
            'negative-tags': 'vocals',
            title: 'Night Rain',
            sd: true,
            timeout: 60,
        });
        expect(mocks.submitSunoGeneration).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            mode: 'custom',
            lyrics: '[Verse]\\nfoo',
            tags: 'synthwave, 95 BPM',
            negativeTags: 'vocals',
            title: 'Night Rain',
        }));
    });

    it('threads --weirdness and --style-weight as numeric sliders', async () => {
        await generateCommand.func(createPage(), {
            lyrics: '[Verse]\\nfoo',
            weirdness: '0.74',
            'style-weight': '0.57',
            sd: true,
            timeout: 60,
        });
        expect(mocks.submitSunoGeneration).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            weirdness: 0.74,
            styleWeight: 0.57,
        }));
    });
});

describe('suno generate paid-format guard', () => {
    it('skips wav by default and surfaces the skip in the result row', async () => {
        const out = await generateCommand.func(createPage(), {
            prompt: 'foo',
            formats: 'mp3,wav,metadata',
            timeout: 60,
        });
        // downloadSunoClip should be called with mp3+metadata, NOT wav
        expect(mocks.downloadSunoClip).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), ['mp3', 'metadata'], okSession.deviceId);
        expect(out[0].files).toContain('skipped(needs --confirm-paid):wav');
    });

    it('includes wav when --confirm-paid is true', async () => {
        await generateCommand.func(createPage(), {
            prompt: 'foo',
            formats: 'mp3,wav',
            'confirm-paid': true,
            timeout: 60,
        });
        expect(mocks.downloadSunoClip).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), ['mp3', 'wav'], okSession.deviceId);
    });

    it('rejects before generation when every requested format is paid and unconfirmed', async () => {
        await expect(generateCommand.func(createPage(), {
            prompt: 'foo',
            formats: 'wav',
            timeout: 60,
        })).rejects.toMatchObject({
            code: 'ARGUMENT',
            message: expect.stringContaining('All requested formats require'),
        });
        expect(mocks.submitSunoGeneration).not.toHaveBeenCalled();
    });
});

describe('suno generate failure paths', () => {
    it('reports all-failed clips with a typed error', async () => {
        mocks.pollSunoClips.mockResolvedValue([
            { id: 'clip-a-id', status: 'error' },
            { id: 'clip-b-id', status: 'error' },
        ]);
        await expect(generateCommand.func(createPage(), { prompt: 'foo', sd: true, timeout: 60 })).rejects.toMatchObject({
            code: 'COMMAND_EXEC',
            message: expect.stringContaining('All Suno clips failed'),
        });
    });

    it('fails typed when generation response clips are malformed', async () => {
        mocks.submitSunoGeneration.mockResolvedValue({ clips: [{ status: 'submitted' }] });
        await expect(generateCommand.func(createPage(), { prompt: 'foo', sd: true, timeout: 60 })).rejects.toMatchObject({
            code: 'COMMAND_EXEC',
            message: expect.stringContaining('malformed clip identity'),
        });
    });

    it('fails typed when download post-condition writes no files', async () => {
        mocks.downloadSunoClip.mockResolvedValue({ slug: 'clip', written: [{ format: 'mp3', file: null, ok: false, reason: 'HTTP 500' }] });
        await expect(generateCommand.func(createPage(), { prompt: 'foo', formats: 'mp3', timeout: 60 })).rejects.toMatchObject({
            code: 'COMMAND_EXEC',
            message: expect.stringContaining('wrote no files'),
        });
    });

    it('skip-download mode returns generated rows without invoking downloadSunoClip', async () => {
        const out = await generateCommand.func(createPage(), { prompt: 'foo', sd: true, timeout: 60 });
        expect(out).toHaveLength(2);
        expect(out[0].status).toBe('🎵 generated');
        expect(mocks.downloadSunoClip).not.toHaveBeenCalled();
    });
});
