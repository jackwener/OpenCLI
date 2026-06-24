import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { smzdmDetailCommand, __test__ } from './detail.js';

function runDetail(html, url = 'https://www.smzdm.com/p/177316535/') {
    const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
    return dom.window.eval(__test__.buildSmzdmDetailJs());
}

describe('smzdm/detail', () => {
    it('declares write-free read access and the detail column set', () => {
        expect(smzdmDetailCommand.access).toBe('read');
        expect(smzdmDetailCommand.columns).toEqual(['id', 'title', 'price', 'buy_link', 'url']);
    });

    it('extracts id, title and price from a deal detail page', () => {
        const html = `
          <h1 class="item-name">香其食品 香其 特级东北老酱油 2.4kg*1桶</h1>
          <div class="over-container"><span class="price-large"><span class="num">19.99</span><span class="yuan">元</span></span></div>`;
        const row = runDetail(html);
        expect(row).toEqual({
            id: '177316535',
            title: '香其食品 香其 特级东北老酱油 2.4kg*1桶',
            price: '19.99元',
            buy_link: '',
            url: 'https://www.smzdm.com/p/177316535/',
        });
    });

    it('captures a go.smzdm.com outbound buy link when present', () => {
        const html = `
          <h1>Deal</h1><span class="price-large">2943.51元</span>
          <a href="https://go.smzdm.com/abc123">去购买</a>`;
        const row = runDetail(html);
        expect(row.price).toBe('2943.51元');
        expect(row.buy_link).toBe('https://go.smzdm.com/abc123');
    });

    it('drops a buy link whose host only looks like go.smzdm.com', () => {
        const html = `<h1>Deal</h1><a href="https://go.smzdm.com.evil.example/x">去购买</a>`;
        expect(runDetail(html).buy_link).toBe('');
    });

    it('falls back to .price when .price-large is absent', () => {
        const html = `<h1>Deal</h1><span class="price">9.9元</span>`;
        expect(runDetail(html).price).toBe('9.9元');
    });

    it('resolves alphanumeric post slugs into the id field', () => {
        const html = `<h1>Article deal</h1>`;
        expect(runDetail(html, 'https://post.smzdm.com/p/aggrg8kw/').id).toBe('aggrg8kw');
    });

    it('fails closed when the title is missing', () => {
        expect(() => __test__.requireDetail({ id: '1', title: '', price: '', buy_link: '', url: 'x' })).toThrow(CommandExecutionError);
    });

    it('fails closed on a non-object extraction payload', () => {
        expect(() => __test__.requireDetail(['not', 'an', 'object'])).toThrow(CommandExecutionError);
    });

    it('validates the deal argument before browser navigation', async () => {
        const page = { goto: vi.fn(), evaluate: vi.fn(), wait: vi.fn() };
        await expect(smzdmDetailCommand.func(page, { deal: 'https://evil.example/p/1/' })).rejects.toBeInstanceOf(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });
});
