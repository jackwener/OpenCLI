import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    ArgumentError,
    AuthRequiredError,
    CommandExecutionError,
    EmptyResultError,
    TimeoutError,
} from '@jackwener/opencli/errors';
import { getRegistry, Strategy } from '@jackwener/opencli/registry';
import './creator-stats.js';

const BVID = 'BV1xx411c7mD';

function manuscript(overrides = {}) {
    return {
        bvid: BVID,
        duration: 240,
        stat: {
            play: 1200,
            like: 80,
            comment: 12,
            dm: 20,
            fav: 30,
            coin: 22,
            share: 9,
            total_new_attention_cnt: 4,
            full_play_ratio: 2345,
            active_fans_rate: 1800,
            tm_rate: 725,
            crash_rate: 310,
            interact_rate: 615,
            play_trans_fan_rate: 125,
        },
        ...overrides,
    };
}

function success(list = [manuscript()]) {
    return { code: 0, message: '0', data: { list } };
}

describe('bilibili creator-stats', () => {
    const command = getRegistry().get('bilibili/creator-stats');
    let page;

    beforeEach(() => {
        page = { fetchJson: vi.fn() };
    });

    it('registers a manuscript-level browser-cookie command with stable metric columns', () => {
        expect(command).toMatchObject({
            strategy: Strategy.COOKIE,
            browser: true,
            access: 'read',
            navigateBefore: 'https://member.bilibili.com/platform/home',
            columns: ['bvid', 'metric', 'value', 'unit'],
        });
        expect(command.args.map((arg) => arg.name)).toEqual(['bvid']);
    });

    it('returns a curated, ordered metric family with real units and no per-part guess', async () => {
        page.fetchJson.mockResolvedValueOnce(success());

        const rows = await command.func(page, {
            bvid: `https://www.bilibili.com/video/${BVID}/?p=2`,
        });

        expect(page.fetchJson).toHaveBeenCalledOnce();
        expect(page.fetchJson).toHaveBeenCalledWith(
            'https://member.bilibili.com/x/web/data/archive_diagnose/compare?size=100',
            { timeoutMs: 15_000 },
        );
        expect(rows.map((row) => row.metric)).toEqual([
            'playCount',
            'likeCount',
            'commentCount',
            'danmakuCount',
            'favoriteCount',
            'coinCount',
            'shareCount',
            'newFollowerCount',
            'durationSeconds',
            'completionPct',
            'activeFollowerViewPct',
            'thumbnailClickPct',
            'threeSecondExitPct',
            'interactionPct',
            'playToFollowerPct',
        ]);
        expect(rows).toContainEqual({ bvid: BVID, metric: 'playCount', value: 1200, unit: 'count' });
        expect(rows).toContainEqual({ bvid: BVID, metric: 'durationSeconds', value: 240, unit: 'seconds' });
        expect(rows).toContainEqual({ bvid: BVID, metric: 'completionPct', value: 23.45, unit: 'percent' });
    });

    it('rejects malformed or case-folded BVIDs before browser access', async () => {
        for (const bvid of ['not-a-bvid', 'bv1xx411c7mD', 'BV123abc']) {
            await expect(command.func(page, { bvid })).rejects.toBeInstanceOf(ArgumentError);
        }
        expect(page.fetchJson).not.toHaveBeenCalled();
    });

    it('keeps target lookup miss and a genuine empty list as EmptyResultError, not auth', async () => {
        page.fetchJson.mockResolvedValueOnce(success([{ ...manuscript(), bvid: 'BV1yy411c7mD' }]));
        await expect(command.func(page, { bvid: BVID })).rejects.toBeInstanceOf(EmptyResultError);

        page.fetchJson.mockResolvedValueOnce(success([]));
        await expect(command.func(page, { bvid: BVID })).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('maps login failures to AuthRequiredError and risk/service failures to CommandExecutionError', async () => {
        page.fetchJson.mockResolvedValueOnce({ code: -101, message: '账号未登录', data: null });
        await expect(command.func(page, { bvid: BVID })).rejects.toBeInstanceOf(AuthRequiredError);

        page.fetchJson.mockRejectedValueOnce(new Error('HTTP 403 Forbidden from https://member.bilibili.com/login'));
        await expect(command.func(page, { bvid: BVID })).rejects.toBeInstanceOf(AuthRequiredError);

        page.fetchJson.mockRejectedValueOnce(new Error('Expected JSON from https://passport.bilibili.com/login'));
        await expect(command.func(page, { bvid: BVID })).rejects.toBeInstanceOf(AuthRequiredError);

        page.fetchJson.mockResolvedValueOnce({ code: -352, message: '风控校验失败', data: null });
        await expect(command.func(page, { bvid: BVID })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('separates browser timeout from other transport failures', async () => {
        page.fetchJson.mockRejectedValueOnce(new Error('The operation was aborted'));
        await expect(command.func(page, { bvid: BVID })).rejects.toBeInstanceOf(TimeoutError);

        page.fetchJson.mockRejectedValueOnce(new Error('Browser bridge disconnected'));
        await expect(command.func(page, { bvid: BVID })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('fails closed on bridge envelopes, malformed rows, duplicates, and missing metrics', async () => {
        const malformedPayloads = [
            { data: success() },
            { code: 0, data: { list: [{ bvid: BVID }] } },
            success([manuscript(), manuscript()]),
            success([manuscript({ stat: { ...manuscript().stat, tm_rate: undefined } })]),
        ];
        for (const payload of malformedPayloads) {
            page.fetchJson.mockResolvedValueOnce(payload);
            await expect(command.func(page, { bvid: BVID })).rejects.toBeInstanceOf(CommandExecutionError);
        }
    });

    it('rejects wrong metric types and percentages outside the documented 0-100 range', async () => {
        page.fetchJson.mockResolvedValueOnce(success([
            manuscript({ stat: { ...manuscript().stat, play: '1200' } }),
        ]));
        await expect(command.func(page, { bvid: BVID })).rejects.toBeInstanceOf(CommandExecutionError);

        page.fetchJson.mockResolvedValueOnce(success([
            manuscript({ stat: { ...manuscript().stat, full_play_ratio: 10_001 } }),
        ]));
        await expect(command.func(page, { bvid: BVID })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('preserves a not-yet-generated metric as null but fails when all analytics are unavailable', async () => {
        page.fetchJson.mockResolvedValueOnce(success([
            manuscript({ stat: { ...manuscript().stat, tm_rate: null } }),
        ]));
        const rows = await command.func(page, { bvid: BVID });
        expect(rows.find((row) => row.metric === 'thumbnailClickPct')?.value).toBeNull();

        const nullStats = Object.fromEntries(Object.keys(manuscript().stat).map((key) => [key, null]));
        page.fetchJson.mockResolvedValueOnce(success([manuscript({ duration: null, stat: nullStats })]));
        await expect(command.func(page, { bvid: BVID })).rejects.toBeInstanceOf(EmptyResultError);
    });
});
