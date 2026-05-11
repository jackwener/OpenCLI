import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { uisdcNewsCommand, __test__ } from './news.js';

function runBrowserScript(html, script, url = 'https://www.uisdc.com/news') {
    const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
    return dom.window.eval(script);
}

function makePage(evaluateResult) {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue(evaluateResult),
    };
}

describe('uisdc/news', () => {
    it('registers stable URL in columns', () => {
        expect(uisdcNewsCommand.access).toBe('read');
        expect(uisdcNewsCommand.columns).toEqual(['rank', 'title', 'summary', 'url']);
    });

    it('validates limit before browser navigation', async () => {
        const page = makePage({ ok: true, rows: [] });
        await expect(uisdcNewsCommand.func(page, { limit: 0 })).rejects.toBeInstanceOf(ArgumentError);
        await expect(uisdcNewsCommand.func(page, { limit: 51 })).rejects.toBeInstanceOf(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('extracts rows from the UISDC news DOM', async () => {
        const html = `
          <div class="news-list">
            <div class="news-item">
              <div class="item-content">
                <div class="dubao-items">
                  <div class="dubao-item">
                    <a href="/article-1"><span class="dubao-title"> AI design news </span></a>
                    <div class="dubao-content"> summary text </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        `;
        const payload = runBrowserScript(html, __test__.buildExtractUisdcNewsJs());
        const page = makePage(payload);

        const rows = await uisdcNewsCommand.func(page, { limit: 10 });

        expect(page.goto).toHaveBeenCalledWith('https://www.uisdc.com/news', { waitUntil: 'load', settleMs: 3000 });
        expect(rows).toEqual([{
            rank: 1,
            title: 'AI design news',
            summary: 'summary text',
            url: 'https://www.uisdc.com/article-1',
        }]);
    });

    it('maps selector drift and empty rows to typed errors', async () => {
        await expect(uisdcNewsCommand.func(makePage({ ok: false, reason: 'selector-missing' }), { limit: 1 }))
            .rejects.toBeInstanceOf(CommandExecutionError);
        await expect(uisdcNewsCommand.func(makePage({ ok: true, rows: [{ title: '', url: '' }] }), { limit: 1 }))
            .rejects.toBeInstanceOf(EmptyResultError);
    });
});
