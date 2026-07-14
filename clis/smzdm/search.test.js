import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { smzdmSearchCommand, __test__ } from './search.js';

function runBrowserScript(html, script, url = 'https://search.smzdm.com/?c=home&s=test&v=b') {
    const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
    return dom.window.eval(script);
}

describe('smzdm/search', () => {
    it('declares read access and the enriched column set', () => {
        expect(smzdmSearchCommand.access).toBe('read');
        expect(smzdmSearchCommand.columns).toEqual([
            'rank', 'title', 'price', 'mall', 'updated_at',
            'zhi_count', 'buzhi_count', 'favorite_count', 'comments', 'url',
        ]);
    });

    it('extracts interaction metrics and update time from a search result item', () => {
        const html = `<ul><li class="feed-row-wide">
          <h5 class="feed-block-title"><a href="https://www.smzdm.com/p/174854494/" title="ThinkBook14+ 轻薄笔记本">ThinkBook14+ 轻薄笔记本</a></h5>
          <span class="z-highlight">4015.44元（需用券）</span>
          <div class="z-feed-foot-l">
            <span class="feed-btn-group price-btn-hover">
              <span class="J_zhi_like_fav price-btn-up" data-type="zhi" data-zhi-type="1"><span class="unvoted-wrap"><span>1.2万</span></span></span>
              <span class="J_zhi_like_fav price-btn-down" data-type="zhi" data-zhi-type="-1"><span class="unvoted-wrap"><span>3</span></span></span>
            </span>
            <span class="J_zhi_like_fav z-group-data feed-btn-fav"><span>40</span></span>
            <a class="z-group-data feed-btn-comment" title="评论数 24">24</a>
          </div>
          <div class="z-feed-foot-r"><span class="feed-block-extras">
            05-23 00:28
            <span>天猫精选</span>
          </span></div>
        </li></ul>`;
        const rows = runBrowserScript(html, __test__.buildSmzdmSearchJs(20));
        expect(rows).toEqual([
            {
                rank: 1,
                title: 'ThinkBook14+ 轻薄笔记本',
                price: '4015.44元（需用券）',
                mall: '天猫精选',
                updated_at: '05-23 00:28',
                zhi_count: 12000,
                buzhi_count: 3,
                favorite_count: 40,
                comments: 24,
                url: 'https://www.smzdm.com/p/174854494/',
            },
        ]);
    });

    it('defaults missing interaction metrics to 0 without dropping columns', () => {
        const html = `<ul><li class="feed-row-wide">
          <h5 class="feed-block-title"><a href="/p/1/" title="No-metrics deal">No-metrics deal</a></h5>
        </li></ul>`;
        const rows = runBrowserScript(html, __test__.buildSmzdmSearchJs(20));
        expect(rows).toEqual([
            {
                rank: 1,
                title: 'No-metrics deal',
                price: '',
                mall: '',
                updated_at: '',
                zhi_count: 0,
                buzhi_count: 0,
                favorite_count: 0,
                comments: 0,
                url: 'https://www.smzdm.com/p/1/',
            },
        ]);
    });

    it('drops untrusted result URLs before output', () => {
        const html = `<ul><li class="feed-row-wide">
          <h5 class="feed-block-title"><a href="https://evil.example/p/1/" title="Bad deal">Bad deal</a></h5>
        </li></ul>`;
        const rows = runBrowserScript(html, __test__.buildSmzdmSearchJs(20));
        expect(rows).toEqual([]);
    });

    it('respects the limit argument', () => {
        const li = `<li class="feed-row-wide"><h5 class="feed-block-title"><a href="/p/9/" title="Deal">Deal</a></h5></li>`;
        const rows = runBrowserScript(`<ul>${li.repeat(5)}</ul>`, __test__.buildSmzdmSearchJs(2));
        expect(rows).toHaveLength(2);
        expect(rows.map((r) => r.rank)).toEqual([1, 2]);
    });

    it('validates --limit before browser navigation', async () => {
        const page = {
            goto: vi.fn(),
            evaluate: vi.fn(),
        };
        await expect(smzdmSearchCommand.func(page, { query: 'test', limit: 0 })).rejects.toBeInstanceOf(ArgumentError);
        await expect(smzdmSearchCommand.func(page, { query: 'test', limit: 101 })).rejects.toBeInstanceOf(ArgumentError);
        await expect(smzdmSearchCommand.func(page, { query: 'test', limit: '1e2' })).rejects.toBeInstanceOf(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('unwraps Browser Bridge evaluate envelopes', () => {
        const rows = [{ rank: 1, title: 'Deal' }];
        expect(__test__.requireSearchRows({ session: 'site:smzdm', data: rows })).toBe(rows);
    });

    it('fails closed on malformed extraction payloads', async () => {
        expect(() => __test__.requireSearchRows({ ok: true })).toThrow(CommandExecutionError);
        const page = {
            goto: vi.fn(),
            evaluate: vi.fn().mockResolvedValue({ ok: true }),
        };
        await expect(smzdmSearchCommand.func(page, { query: 'test', limit: 5 })).rejects.toBeInstanceOf(CommandExecutionError);
    });
});
