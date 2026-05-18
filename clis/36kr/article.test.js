import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';
import './article.js';

function makePage(evaluateResult) {
    return {
        installInterceptor: vi.fn().mockResolvedValue(undefined),
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue(evaluateResult),
    };
}

describe('36kr article', () => {
    it('emits empty-string for missing optional author / date instead of a sentinel', async () => {
        const command = getRegistry().get('36kr/article');
        expect(command?.func).toBeDefined();
        const page = makePage({ title: 'Real Title', author: '', date: '', body: 'Real article body' });
        const rows = await command.func(page, { id: '1234567' });
        const byField = Object.fromEntries(rows.map((r) => [r.field, r.value]));
        expect(byField.title).toBe('Real Title');
        expect(byField.author).toBe('');
        expect(byField.date).toBe('');
        expect(byField.body).toBe('Real article body');
        expect(byField.url).toBe('https://36kr.com/p/1234567');
    });

    it('throws CliError NOT_FOUND when the page exposes no title', async () => {
        const command = getRegistry().get('36kr/article');
        const page = makePage({ title: '', author: 'x', date: 'y', body: 'z' });
        await expect(command.func(page, { id: '1234567' })).rejects.toBeInstanceOf(CliError);
    });

    it('throws CliError PARSE_ERROR when the page exposes title but no body', async () => {
        const command = getRegistry().get('36kr/article');
        const page = makePage({ title: 'Real Title', author: 'x', date: 'y', body: '' });
        await expect(command.func(page, { id: '1234567' })).rejects.toMatchObject({ code: 'PARSE_ERROR' });
    });

    it('throws CliError INVALID_ARGUMENT when no numeric id can be parsed', async () => {
        const command = getRegistry().get('36kr/article');
        const page = makePage({});
        await expect(command.func(page, { id: 'not-a-url' })).rejects.toBeInstanceOf(CliError);
    });
});
