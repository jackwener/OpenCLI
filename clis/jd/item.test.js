import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { getRegistry } from '@jackwener/opencli/registry';
import { AuthRequiredError } from '@jackwener/opencli/errors';
import { __test__ } from './item.js';
import './item.js';
const originalPerformance = globalThis.performance;
const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
function restoreGlobals() {
    globalThis.performance = originalPerformance;
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
}
describe('jd item adapter', () => {
    const command = getRegistry().get('jd/item');
    it('registers the command with correct shape', () => {
        expect(command).toBeDefined();
        expect(command.site).toBe('jd');
        expect(command.name).toBe('item');
        expect(command.domain).toBe('item.jd.com');
        expect(command.strategy).toBe('cookie');
        expect(typeof command.func).toBe('function');
    });
    it('has sku as a required positional arg', () => {
        const skuArg = command.args.find((a) => a.name === 'sku');
        expect(skuArg).toBeDefined();
        expect(skuArg.required).toBe(true);
        expect(skuArg.positional).toBe(true);
    });
    it('has images arg with default 200', () => {
        const imagesArg = command.args.find((a) => a.name === 'images');
        expect(imagesArg).toBeDefined();
        expect(imagesArg.default).toBe(200);
    });
    it('fails fast when JD blocks the item page', async () => {
        const page = {
            evaluate: vi.fn()
                .mockResolvedValueOnce('https://item.jd.com/100328272886.html')
                .mockResolvedValueOnce({ looksBlocked: true })
                .mockResolvedValueOnce({
                error: 'JD page is blocked by login/security verification',
                pageState: { looksBlocked: true },
            }),
            goto: vi.fn(),
            wait: vi.fn(),
        };
        await expect(command.func(page, { sku: '100328272886', images: 5 })).rejects.toBeInstanceOf(AuthRequiredError);
        expect(page.goto).not.toHaveBeenCalled();
    });
    it('fails fast when a loaded product page has no detail images', async () => {
        const page = {
            evaluate: vi.fn()
                .mockResolvedValueOnce('https://item.jd.com/100328272886.html')
                .mockResolvedValueOnce({ looksBlocked: false })
                .mockResolvedValueOnce(undefined)
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce({
                title: 'JD product',
                price: '100',
                shop: '京东自营',
                specs: {},
                mainImages: ['https://img10.360buyimg.com/pcpubliccms/jfs/t1/main.jpg'],
                detailImages: [],
                pageState: { isProductPage: true, looksBlocked: false },
            }),
            goto: vi.fn(),
            wait: vi.fn(),
        };
        await expect(command.func(page, { sku: '100328272886', images: 5 })).rejects.toThrow('JD item detail images were not found');
    });
    it('allows zero-image requests to skip detail image fail-fast', async () => {
        const data = {
            title: 'JD product',
            price: '100',
            shop: '京东自营',
            specs: {},
            mainImages: [],
            detailImages: [],
            pageState: { isProductPage: true, looksBlocked: false },
        };
        const page = {
            evaluate: vi.fn()
                .mockResolvedValueOnce('https://item.jd.com/100328272886.html')
                .mockResolvedValueOnce({ looksBlocked: false })
                .mockResolvedValueOnce(undefined)
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce(data),
            goto: vi.fn(),
            wait: vi.fn(),
        };
        await expect(command.func(page, { sku: '100328272886', images: 0 })).resolves.toEqual([data]);
    });
    it('normalizes JD item URL input to a SKU before building selectors', () => {
        expect(__test__.normalizeJdSkuInput('100328272886')).toBe('100328272886');
        expect(__test__.normalizeJdSkuInput('https://item.jd.com/100328272886.html?purchasetab=gfgm')).toBe('100328272886');
        expect(__test__.normalizeJdSkuInput('skuId=10218494560141')).toBe('10218494560141');
    });
    it('includes expected columns', () => {
        expect(command.columns).toEqual(expect.arrayContaining(['title', 'price', 'shop', 'specs', 'mainImages', 'detailImages']));
        expect(command.columns).not.toContain('avifImages');
    });
    it('extracts only detail avif images and respects the limit', () => {
        const result = __test__.extractAvifImages([
            'https://img14.360buyimg.com/n1/jfs/t1/normal.jpg',
            'https://img10.360buyimg.com/imgzone/jfs/t1/detail.avif',
            'https://pcpubliccms.jd.com/image1.avif',
            'https://pcpubliccms.jd.com/image1.avif',
            'https://pcpubliccms.jd.com/image2.avif?x=1',
            'https://example.com/not-jd.avif',
        ], 2);
        expect(result).toEqual([
            'https://img10.360buyimg.com/imgzone/jfs/t1/detail.avif',
        ]);
    });
    it('treats WareGraphic sku images as detail images only for WareGraphic fallback', () => {
        expect(__test__.isJdDetailImage('https://img10.360buyimg.com/sku/jfs/t1/color-option.gif')).toBe(false);
        expect(__test__.isJdWareGraphicDetailImage('https://img10.360buyimg.com/sku/jfs/t1/ware-graphic.jpg')).toBe(true);
        expect(__test__.isJdWareGraphicDetailImage('https://img10.360buyimg.com/sku/s228x228_jfs/t1/thumb.jpg')).toBe(false);
    });
    it('keeps main gallery images while ignoring unrelated contexts for detail images', () => {
        const dom = new JSDOM(`
      <div class="_gallery_116km_1">
        <img src="https://img10.360buyimg.com/pcpubliccms/jfs/t1/main-a.jpg" />
        <img data-src="//img10.360buyimg.com/n1/jfs/t1/main-b.jpg" />
      </div>
      <div class="recommend">
        <img src="https://img10.360buyimg.com/imgzone/jfs/t1/recommend.jpg.avif" />
      </div>
      <div class="detail-content-wrap">
        <img src="https://img10.360buyimg.com/imgzone/jfs/t1/detail-a.jpg.avif" />
      </div>
    `);
        const previousDocument = globalThis.document;
        globalThis.document = dom.window.document;
        try {
            expect(__test__.extractMainImages(10)).toEqual([
                'https://img10.360buyimg.com/pcpubliccms/jfs/t1/main-a.jpg',
                'https://img10.360buyimg.com/n1/jfs/t1/main-b.jpg',
            ]);
            expect(__test__.extractDetailImagesFromDom(10)).toEqual([
                'https://img10.360buyimg.com/imgzone/jfs/t1/detail-a.jpg.avif',
            ]);
        }
        finally {
            globalThis.document = previousDocument;
        }
    });
    it('collects JD detail images from computed background images', () => {
        const dom = new JSDOM(`
      <div id="J-detail">
        <div class="ssd-module computed-bg"></div>
        <div class="ssd-module ignored-bg"></div>
      </div>
    `);
        const previousDocument = globalThis.document;
        const previousGetComputedStyle = globalThis.getComputedStyle;
        globalThis.document = dom.window.document;
        globalThis.getComputedStyle = ((element) => ({
            background: '',
            backgroundImage: element.classList.contains('computed-bg')
                ? 'url("//img10.360buyimg.com/imgzone/jfs/t1/computed-detail.jpg.avif")'
                : 'none',
        }));
        try {
            expect(__test__.extractDetailImagesFromDom(10)).toEqual([
                'https://img10.360buyimg.com/imgzone/jfs/t1/computed-detail.jpg.avif',
            ]);
        }
        finally {
            globalThis.document = previousDocument;
            globalThis.getComputedStyle = previousGetComputedStyle;
        }
    });
    it('collects JD detail images from inline JSON-like script text', () => {
        const dom = new JSDOM(`
      <h2 id="SPXQ-title">商品详情</h2>
      <script>
        window.__DETAIL_DATA__ = {
          images: [
            "https://img10.360buyimg.com/imgzone/jfs/t1/script-detail-a.jpg.avif",
            "//img11.360buyimg.com/imgzone/jfs/t1/script-detail-b.gif"
          ]
        };
      </script>
    `);
        const previousDocument = globalThis.document;
        globalThis.document = dom.window.document;
        try {
            expect(__test__.extractDetailImagesFromDom(10)).toEqual([
                'https://img10.360buyimg.com/imgzone/jfs/t1/script-detail-a.jpg.avif',
                'https://img11.360buyimg.com/imgzone/jfs/t1/script-detail-b.gif',
            ]);
        }
        finally {
            globalThis.document = previousDocument;
        }
    });
    it('collects JD detail images from same-origin iframe content', () => {
        const dom = new JSDOM(`
      <h2 id="SPXQ-title">商品详情</h2>
      <iframe id="detail-frame"></iframe>
    `, { url: 'https://item.jd.com/100328272886.html' });
        const frameDom = new JSDOM(`
      <div id="J-detail">
        <img src="https://img10.360buyimg.com/imgzone/jfs/t1/frame-detail-a.jpg.avif" />
        <div style="background-image:url(//img11.360buyimg.com/cms/jfs/t1/frame-detail-b.jpg.avif)"></div>
      </div>
    `, { url: 'https://item.jd.com/detail-frame.html' });
        const iframe = dom.window.document.getElementById('detail-frame');
        Object.defineProperty(iframe, 'contentDocument', { value: frameDom.window.document, configurable: true });
        Object.defineProperty(iframe, 'contentWindow', { value: frameDom.window, configurable: true });
        const previousDocument = globalThis.document;
        globalThis.document = dom.window.document;
        try {
            expect(__test__.extractDetailImagesFromDom(10)).toEqual([
                'https://img10.360buyimg.com/imgzone/jfs/t1/frame-detail-a.jpg.avif',
                'https://img11.360buyimg.com/cms/jfs/t1/frame-detail-b.jpg.avif',
            ]);
        }
        finally {
            globalThis.document = previousDocument;
        }
    });
    it('collects JD detail images from page data objects', async () => {
        const dom = new JSDOM(`
      <h2 id="SPXQ-title">商品详情</h2>
    `);
        globalThis.document = dom.window.document;
        globalThis.window = dom.window;
        globalThis.__PAGE_DATA__ = {
            detail: {
                images: [
                    'https://img10.360buyimg.com/imgzone/jfs/t1/page-data-a.jpg.avif',
                    { src: '//img11.360buyimg.com/imgzone/jfs/t1/page-data-b.webp' },
                ],
            },
        };
        try {
            await expect(__test__.extractDetailImagesFromPage(10)).resolves.toEqual([
                'https://img10.360buyimg.com/imgzone/jfs/t1/page-data-a.jpg.avif',
                'https://img11.360buyimg.com/imgzone/jfs/t1/page-data-b.webp',
            ]);
        }
        finally {
            delete globalThis.__PAGE_DATA__;
            restoreGlobals();
        }
    });
    it('collects JD detail images from network resource text', async () => {
        const dom = new JSDOM(`
      <h2 id="SPXQ-title">商品详情</h2>
    `);
        const previousFetch = globalThis.fetch;
        globalThis.document = dom.window.document;
        globalThis.window = dom.window;
        globalThis.performance = {
            getEntriesByType: () => [{ name: 'https://cdn.jd.com/detail/data.json' }],
            now: () => 0,
        };
        globalThis.fetch = (async () => ({
            ok: true,
            headers: { get: () => 'application/json' },
            text: async () => JSON.stringify({
                detail: {
                    imgs: ['https://img10.360buyimg.com/imgzone/jfs/t1/network-detail-a.jpg.avif'],
                },
            }),
        }));
        try {
            await expect(__test__.extractDetailImagesFromPage(10)).resolves.toEqual([
                'https://img10.360buyimg.com/imgzone/jfs/t1/network-detail-a.jpg.avif',
            ]);
        }
        finally {
            globalThis.fetch = previousFetch;
            restoreGlobals();
        }
    });
    it('collects JD detail images from WareGraphic graphicContent', async () => {
        const dom = new JSDOM(`
      <h2 id="SPXQ-title">商品详情</h2>
    `);
        const previousFetch = globalThis.fetch;
        globalThis.document = dom.window.document;
        globalThis.window = dom.window;
        globalThis.performance = {
            getEntriesByType: () => [
                { name: 'https://api.m.jd.com/client.action?functionId=pc_item_getWareGraphic&skuId=100328272886' },
            ],
            now: () => 0,
        };
        globalThis.fetch = (async () => ({
            ok: true,
            headers: { get: () => 'application/json' },
            text: async () => JSON.stringify({
                data: {
                    graphicContent: `
            <div style="background-image:url(//img30.360buyimg.com/sku/jfs/t1/ware-a.jpg)"></div>
            <img src="https://img30.360buyimg.com/sku/jfs/t1/ware-b.png" />
            <a href="https://item.jd.com/100328272886.html">not image</a>
          `,
                },
            }),
        }));
        try {
            await expect(__test__.extractDetailImagesFromPage(10)).resolves.toEqual([
                'https://img30.360buyimg.com/sku/jfs/t1/ware-a.jpg',
                'https://img30.360buyimg.com/sku/jfs/t1/ware-b.png',
            ]);
        }
        finally {
            globalThis.fetch = previousFetch;
            restoreGlobals();
        }
    });
    it('extracts selected specs from the newer JD spec-list DOM', () => {
        const dom = new JSDOM(`
      <div id="spec-list" class="page-right-spec">
        <div class="horizontal-layout specification-series-layout">
          <div class="layout-label">系列品</div>
          <div class="layout-content">
            <div class="specification-series-item specification-series-item--selected">
              <span class="specification-series-item-text">【年度新品】玉兔3.0pro 12kg</span>
            </div>
            <div class="specification-series-item"><span class="specification-series-item-text">其他系列</span></div>
          </div>
        </div>
        <div class="specifications-panel-content">
          <div class="specification-group">
            <div class="specification-group-label">款式</div>
            <div class="specification-group-content">
              <div class="specification-item-sku has-image specification-item-sku--selected" title="">
                <img class="specification-item-sku-image" alt="洗烘套装" src="https://img13.360buyimg.com/pcpubliccms/s48x48_jfs/t1/spec.jpg.avif" />
                <span class="specification-item-sku-text">洗烘套装</span>
              </div>
              <div class="specification-item-sku has-image"><span class="specification-item-sku-text">滚筒单洗</span></div>
            </div>
          </div>
        </div>
      </div>
    `);
        globalThis.document = dom.window.document;
        try {
            expect(__test__.extractSpecs()).toEqual({
                系列品: '【年度新品】玉兔3.0pro 12kg',
                款式: '洗烘套装',
            });
        }
        finally {
            restoreGlobals();
        }
    });
});
