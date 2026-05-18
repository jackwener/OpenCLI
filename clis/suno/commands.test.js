import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';

const mocks = vi.hoisted(() => ({
    ensureSunoSession: vi.fn(),
    checkSunoCaptcha: vi.fn(),
}));

vi.mock('./utils.js', () => ({
    STUDIO_API: 'https://studio-api-prod.suno.com',
    SUNO_DOMAIN: 'suno.com',
    SUNO_URL: 'https://suno.com',
    ensureSunoSession: mocks.ensureSunoSession,
    checkSunoCaptcha: mocks.checkSunoCaptcha,
    requireNonNegativeInt: (value) => {
        const n = Number(value);
        if (!Number.isInteger(n) || n < 0) throw Object.assign(new Error('non-negative int required'), { code: 'ARGUMENT' });
        return n;
    },
    requirePositiveInt: (value) => {
        const n = Number(value);
        if (!Number.isInteger(n) || n < 1) throw Object.assign(new Error('positive int required'), { code: 'ARGUMENT' });
        return n;
    },
    unwrapEvaluateResult: (value) => value && typeof value === 'object' && 'session' in value && 'data' in value ? value.data : value,
}));

const { statusCommand } = await import('./status.js');
const { listCommand } = await import('./list.js');

function createPage(evaluateImpl) {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate: evaluateImpl || vi.fn().mockResolvedValue(undefined),
    };
}

beforeEach(() => {
    vi.restoreAllMocks();
});

describe('suno status', () => {
    it('reports "Not logged in" when ensureSunoSession throws AuthRequiredError', async () => {
        mocks.ensureSunoSession.mockRejectedValue(new AuthRequiredError('suno.com', 'Auth required'));
        const out = await statusCommand.func(createPage());
        expect(out).toEqual([{
            Status: 'Not logged in',
            Plan: '-',
            Credits: '-',
            Monthly: '-',
            Captcha: '-',
        }]);
    });

    it('does not hide non-auth status failures as logged-out rows', async () => {
        mocks.ensureSunoSession.mockRejectedValue(new CommandExecutionError('malformed billing payload'));
        await expect(statusCommand.func(createPage())).rejects.toMatchObject({
            code: 'COMMAND_EXEC',
            message: expect.stringContaining('malformed billing payload'),
        });
    });

    it('returns plan / credits / captcha when the session is healthy', async () => {
        mocks.ensureSunoSession.mockResolvedValue({
            ok: true,
            planKey: 'pro',
            planId: '3eaebef3',
            totalCreditsAvailable: 2095,
            breakdown: { pack: 0, purchasedPacks: 0, monthlyRemaining: 2095, monthlyLimit: 2500, monthlyUsed: 405 },
            deviceId: 'device-uuid',
        });
        mocks.checkSunoCaptcha.mockResolvedValue({ ok: true, required: false });
        const out = await statusCommand.func(createPage());
        expect(out[0]).toMatchObject({
            Status: 'Connected',
            Plan: 'pro',
            Credits: '2095',
            Monthly: '2095/2500',
            Captcha: 'Not required',
        });
    });

    it('reports captcha required when /api/c/check says so', async () => {
        mocks.ensureSunoSession.mockResolvedValue({
            ok: true, planKey: 'pro', planId: 'x', totalCreditsAvailable: 100,
            breakdown: { pack: 0, purchasedPacks: 0, monthlyRemaining: 100, monthlyLimit: 2500, monthlyUsed: 2400 },
            deviceId: 'device-uuid',
        });
        mocks.checkSunoCaptcha.mockResolvedValue({ ok: true, required: true });
        const out = await statusCommand.func(createPage());
        expect(out[0].Captcha).toContain('Required');
    });
});

describe('suno list', () => {
    it('returns clip rows with truncated id, title, and pagination-aware rank', async () => {
        mocks.ensureSunoSession.mockResolvedValue({ deviceId: 'device-uuid' });
        const page = createPage(vi.fn().mockResolvedValue({
            ok: true,
            clips: [
                { id: 'aaaaaaaa-1111-2222-3333-444444444444', title: 'Track One', status: 'complete', created_at: '2026-05-17T11:14:26.338Z' },
                { id: 'bbbbbbbb-1111-2222-3333-444444444444', title: 'Track Two', status: 'streaming', created_at: '2026-05-17T11:00:00.000Z' },
            ],
        }));
        const out = await listCommand.func(page, { limit: 10, page: 0 });
        expect(out).toHaveLength(2);
        expect(out[0]).toMatchObject({
            rank: 1,
            clip: 'aaaaaaaa',
            title: 'Track One',
            status: 'complete',
            created: '2026-05-17 11:14:26',
            link: 'https://suno.com/song/aaaaaaaa-1111-2222-3333-444444444444',
        });
    });

    it('respects --limit (caller may receive more from feed and slice down)', async () => {
        mocks.ensureSunoSession.mockResolvedValue({ deviceId: 'device-uuid' });
        const page = createPage(vi.fn().mockResolvedValue({
            ok: true,
            clips: [
                { id: 'aaaaaaaa-1111-2222-3333-444444444444', title: 'A', status: 'complete', created_at: '2026-05-17T00:00:00Z' },
                { id: 'bbbbbbbb-1111-2222-3333-444444444444', title: 'B', status: 'complete', created_at: '2026-05-17T00:00:00Z' },
                { id: 'cccccccc-1111-2222-3333-444444444444', title: 'C', status: 'complete', created_at: '2026-05-17T00:00:00Z' },
            ],
        }));
        const out = await listCommand.func(page, { limit: 2, page: 0 });
        expect(out).toHaveLength(2);
    });

    it('rejects invalid --page instead of silently clamping to zero', async () => {
        mocks.ensureSunoSession.mockResolvedValue({ deviceId: 'device-uuid' });
        await expect(listCommand.func(createPage(), { limit: 2, page: -1 })).rejects.toMatchObject({
            code: 'ARGUMENT',
        });
    });

    it('unwraps Browser Bridge envelopes around feed rows', async () => {
        mocks.ensureSunoSession.mockResolvedValue({ deviceId: 'device-uuid' });
        const page = createPage(vi.fn().mockResolvedValue({
            session: 'browser:default',
            data: {
                ok: true,
                clips: [
                    { id: 'aaaaaaaa-1111-2222-3333-444444444444', title: 'Track One', status: 'complete', created_at: '2026-05-17T11:14:26.338Z' },
                ],
            },
        }));
        const out = await listCommand.func(page, { limit: 10, page: 0 });
        expect(out[0].clip).toBe('aaaaaaaa');
    });

    it('returns EmptyResultError for a valid empty library response', async () => {
        mocks.ensureSunoSession.mockResolvedValue({ deviceId: 'device-uuid' });
        const page = createPage(vi.fn().mockResolvedValue({ ok: true, clips: [] }));
        await expect(listCommand.func(page, { limit: 10, page: 0 })).rejects.toMatchObject({
            code: 'EMPTY_RESULT',
        });
    });

    it('fails typed on malformed clip identity', async () => {
        mocks.ensureSunoSession.mockResolvedValue({ deviceId: 'device-uuid' });
        const page = createPage(vi.fn().mockResolvedValue({ ok: true, clips: [{ title: 'No id' }] }));
        await expect(listCommand.func(page, { limit: 10, page: 0 })).rejects.toMatchObject({
            code: 'COMMAND_EXEC',
            message: expect.stringContaining('malformed clip identity'),
        });
    });

    it('surfaces feed lookup HTTP failures', async () => {
        mocks.ensureSunoSession.mockResolvedValue({ deviceId: 'device-uuid' });
        const page = createPage(vi.fn().mockResolvedValue({ ok: false, status: 500 }));
        await expect(listCommand.func(page, { limit: 5, page: 0 })).rejects.toMatchObject({
            code: 'COMMAND_EXEC',
            message: expect.stringContaining('HTTP 500'),
        });
    });

    it('surfaces malformed feed payloads as typed failures', async () => {
        mocks.ensureSunoSession.mockResolvedValue({ deviceId: 'device-uuid' });
        const page = createPage(vi.fn().mockResolvedValue({ ok: false, error: 'malformed clips payload' }));
        await expect(listCommand.func(page, { limit: 5, page: 0 })).rejects.toMatchObject({
            code: 'COMMAND_EXEC',
            message: expect.stringContaining('malformed clips payload'),
        });
    });
});
