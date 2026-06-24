import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { ArgumentError } from '@jackwener/opencli/errors';
import { smzdmHotCommand, __test__ } from './hot.js';

function runFeed(html, limit = 20, url = 'https://www.smzdm.com/jingxuan/') {
    const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
    return dom.window.eval(__test__.buildSmzdmFeedJs(limit));
}

describe('smzdm/hot', () => {
    it('declares read access and the shared feed column set', () => {
        expect(smzdmHotCommand.access).toBe('read');
        expect(smzdmHotCommand.columns).toEqual([
            'rank', 'title', 'price', 'mall', 'updated_at',
            'zhi_count', 'buzhi_count', 'favorite_count', 'comments', 'url',
        ]);
    });

    it('extracts the curated home feed with the same markup as search', () => {
        const html = `<ul><li class="feed-row-wide">
          <h5 class="feed-block-title"><a href="/p/177316528/">修洁 山型凸面成人护龈软毛牙刷</a></h5>
          <span class="z-highlight">19.9元</span>
        </li></ul>`;
        const rows = runFeed(html);
        expect(rows).toEqual([
            {
                rank: 1,
                title: '修洁 山型凸面成人护龈软毛牙刷',
                price: '19.9元',
                mall: '',
                updated_at: '',
                zhi_count: 0,
                buzhi_count: 0,
                favorite_count: 0,
                comments: 0,
                url: 'https://www.smzdm.com/p/177316528/',
            },
        ]);
    });

    it('extracts the mall from an <a> link and keeps the time out of it (home feed shape)', () => {
        const html = `<ul><li class="feed-row-wide">
          <h5 class="feed-block-title"><a href="/p/177249882/" title="西凤酒">西凤酒</a></h5>
          <span class="z-highlight">399元</span>
          <div class="z-feed-foot-r"><span class="feed-block-extras">
            16:18
            <a href="https://www.smzdm.com/mall/tmallchaoshi/">天猫超市</a>
          </span></div>
        </li></ul>`;
        const [row] = runFeed(html);
        expect(row.mall).toBe('天猫超市');
        expect(row.updated_at).toBe('16:18');
    });

    it('respects the limit argument', () => {
        const li = `<li class="feed-row-wide"><h5 class="feed-block-title"><a href="/p/9/" title="Deal">Deal</a></h5></li>`;
        expect(runFeed(`<ul>${li.repeat(5)}</ul>`, 2)).toHaveLength(2);
    });

    it('validates --limit before browser navigation', async () => {
        const page = { goto: vi.fn(), evaluate: vi.fn() };
        await expect(smzdmHotCommand.func(page, { limit: 0 })).rejects.toBeInstanceOf(ArgumentError);
        await expect(smzdmHotCommand.func(page, { limit: 101 })).rejects.toBeInstanceOf(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });
});
