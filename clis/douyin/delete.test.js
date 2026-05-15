import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';

const mocks = vi.hoisted(() => ({
    browserFetch: vi.fn(),
}));

vi.mock('./_shared/browser-fetch.js', () => ({ browserFetch: mocks.browserFetch }));

import './delete.js';

function makePage({ evaluateResult, listBefore = [], listAfter = [] } = {}) {
    let listCalls = 0;
    mocks.browserFetch.mockImplementation(async (_page, method, url) => {
        if (method === 'GET' && String(url).includes('/work_list?')) {
            listCalls += 1;
            return { aweme_list: listCalls === 1 ? listBefore : listAfter };
        }
        return { status_code: 0 };
    });
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue(evaluateResult ?? { ok: false, reason: 'not_found' }),
        wait: vi.fn().mockResolvedValue(undefined),
    };
}

describe('douyin delete registration', () => {
    const command = getRegistry().get('douyin/delete');

    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('registers the delete command', () => {
        const registry = getRegistry();
        const values = [...registry.values()];
        const cmd = values.find(c => c.site === 'douyin' && c.name === 'delete');
        expect(cmd).toBeDefined();
    });

    it('uses work_list id/index matching instead of title matching for fallback deletion', () => {
        const source = readFileSync(new URL('./delete.js', import.meta.url), 'utf8');
        expect(source).toContain('target_not_unique');
        expect(source).toContain("String(entry.aweme_id || '') === targetId");
        expect(source).toContain('cards[target.index]');
        expect(source).not.toContain('text.includes(target.title)');
    });

    it('validates aweme_id before navigation', async () => {
        const page = makePage();
        await expect(command.func(page, { aweme_id: '' })).rejects.toBeInstanceOf(ArgumentError);
        await expect(command.func(page, { aweme_id: 'abc' })).rejects.toBeInstanceOf(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('does not treat a missing work as successful delete', async () => {
        const page = makePage({ listBefore: [], listAfter: [] });
        const promise = command.func(page, { aweme_id: '123' });
        const assertion = expect(promise).rejects.toBeInstanceOf(CommandExecutionError);
        await vi.advanceTimersByTimeAsync(7000);
        await assertion;
    });

    it('unwraps Browser Bridge envelopes around creator manage delete results', async () => {
        const page = makePage({ evaluateResult: { session: 'site:douyin:test', data: { ok: true, aweme_id: '123' } } });
        const promise = command.func(page, { aweme_id: '123' });
        const assertion = expect(promise).resolves.toEqual([{ status: '✅ 已通过后台管理删除 123' }]);
        await vi.advanceTimersByTimeAsync(7000);
        await assertion;
        expect(mocks.browserFetch).not.toHaveBeenCalled();
    });

    it('throws typed on malformed creator manage delete result', async () => {
        const page = makePage({ evaluateResult: 'bad-shape' });
        const promise = command.func(page, { aweme_id: '123' });
        const assertion = expect(promise).rejects.toBeInstanceOf(CommandExecutionError);
        await vi.advanceTimersByTimeAsync(7000);
        await assertion;
        expect(mocks.browserFetch).not.toHaveBeenCalled();
    });

    it('returns success only after fallback delete postcondition removes the target', async () => {
        const page = makePage({
            listBefore: [{ aweme_id: '123' }],
            listAfter: [],
        });
        const promise = command.func(page, { aweme_id: '123' });
        const assertion = expect(promise).resolves.toEqual([{ status: '✅ 已删除 123' }]);
        await vi.advanceTimersByTimeAsync(8000);
        await assertion;
    });
});
