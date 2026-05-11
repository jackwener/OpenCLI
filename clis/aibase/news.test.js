import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { aibaseNewsCommand, __test__ } from './news.js';

function runBrowserScript(html, script, url = 'https://www.aibase.com/zh/daily') {
    const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
    return dom.window.eval(script);
}

function makePage(evaluateResult) {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue(evaluateResult),
    };
}

describe('aibase/news', () => {
    it('registers stable URL in columns', () => {
        expect(aibaseNewsCommand.access).toBe('read');
        expect(aibaseNewsCommand.columns).toEqual(['rank', 'title', 'url']);
    });

    it('validates limit before browser navigation', async () => {
        const page = makePage({ ok: true, rows: [] });
        await expect(aibaseNewsCommand.func(page, { limit: 0 })).rejects.toBeInstanceOf(ArgumentError);
        await expect(aibaseNewsCommand.func(page, { limit: 51 })).rejects.toBeInstanceOf(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('extracts and deduplicates AIbase daily rows', async () => {
        const html = `
          <div class="bg-white">
            <div class="grid">
              <a href="/zh/daily/123"> First AI daily item </a>
              <a href="/zh/daily/123"> First AI daily item duplicate </a>
              <a href="/zh/daily/456"> Second AI daily item </a>
            </div>
          </div>
        `;
        const payload = runBrowserScript(html, __test__.buildExtractAibaseNewsJs());
        const page = makePage(payload);

        const rows = await aibaseNewsCommand.func(page, { limit: 2 });

        expect(page.goto).toHaveBeenCalledWith('https://www.aibase.com/zh/daily', { waitUntil: 'load', settleMs: 3000 });
        expect(rows).toEqual([
            { rank: 1, title: 'First AI daily item', url: 'https://www.aibase.com/zh/daily/123' },
            { rank: 2, title: 'Second AI daily item', url: 'https://www.aibase.com/zh/daily/456' },
        ]);
    });

    it('maps selector drift and empty rows to typed errors', async () => {
        await expect(aibaseNewsCommand.func(makePage({ ok: false, reason: 'selector-missing' }), { limit: 1 }))
            .rejects.toBeInstanceOf(CommandExecutionError);
        await expect(aibaseNewsCommand.func(makePage({ ok: true, rows: [{ title: '', url: '' }] }), { limit: 1 }))
            .rejects.toBeInstanceOf(EmptyResultError);
    });
});
