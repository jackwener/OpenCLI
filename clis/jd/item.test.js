import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { getRegistry } from '@jackwener/opencli/registry';
import { __test__ } from './item.js';
import './item.js';
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
});
