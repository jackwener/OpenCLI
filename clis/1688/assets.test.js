import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { __test__ } from './assets.js';
import { __test__ as sharedTest } from './shared.js';

function makeDetailHostDom() {
    // 模拟 1688 详情页：详情图片位于 v-detail-e（class=html-description）
    // 的 shadow DOM 内，普通 CSS selector 无法穿透 shadowRoot。
    const dom = new JSDOM(
        `<html><body>
        <div class="detail-gallery-turn"><img src="https://img.example.com/main-1.jpg"></div>
        <v-detail-e class="html-description"></v-detail-e>
        <div class="de-description-detail"><img src="https://img.example.com/light-1.jpg"></div>
        </body></html>`,
        { url: 'https://detail.1688.com/offer/887904326744.html' },
    );
    const { window } = dom;
    const host = window.document.querySelector('v-detail-e');
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
        <img src="https://img.example.com/detail-1.jpg">
        <img data-lazyload-src="https://img.example.com/detail-2.jpg">
        <img src="https://img.example.com/detail-3.jpg">
    `;
    return { window, host, shadow };
}

describe('1688 assets shadow-DOM detail container detection', () => {
    it('detects images inside the v-detail-e shadow root as detail assets', () => {
        const { window, shadow } = makeDetailHostDom();
        const shadowImgs = [...shadow.querySelectorAll('img, source')];
        expect(shadowImgs.length).toBe(3);
        for (const el of shadowImgs) {
            expect(__test__.inDetailContainer(el)).toBe(true);
        }
    });

    it('does not match light-DOM main gallery images', () => {
        const { window } = makeDetailHostDom();
        const mainImg = window.document.querySelector('.detail-gallery-turn img');
        expect(__test__.inDetailContainer(mainImg)).toBe(false);
    });

    it('matches light-DOM detail containers that use plain classes', () => {
        const { window } = makeDetailHostDom();
        const lightDetail = window.document.querySelector('.de-description-detail img');
        expect(__test__.inDetailContainer(lightDetail)).toBe(true);
    });
});

// Restored from main: this PR originally replaced these two rather than adding
// alongside them, which silently dropped all coverage of normalizeAssets and
// normalizeMediaUrl.
describe('1688 assets normalization', () => {
    it('normalizes gallery and scanned assets into grouped media lists', () => {
        const result = __test__.normalizeAssets({
            href: 'https://detail.1688.com/offer/887904326744.html',
            title: '测试商品 - 阿里巴巴',
            offerTitle: '测试商品',
            offerId: 887904326744,
            gallery: {
                mainImage: ['//img.example.com/main-1.jpg'],
                offerImgList: ['https://img.example.com/main-2.jpg'],
                wlImageInfos: [{ fullPathImageURI: 'https://img.example.com/main-3.jpg' }],
            },
            scannedAssets: [
                { type: 'image', group: 'sku', url: 'https://img.example.com/sku-1.png', source: 'dom:.sku' },
                { type: 'image', group: 'detail', url: 'https://img.example.com/detail-1.jpg', source: 'dom:.detail' },
                { type: 'video', group: 'video', url: 'https://video.example.com/demo.mp4', source: 'script' },
                { type: 'image', group: 'detail', url: 'blob:https://detail.1688.com/1', source: 'ignore' },
            ],
        });
        expect(result.offer_id).toBe('887904326744');
        expect(result.main_images).toEqual([
            'https://img.example.com/main-1.jpg',
            'https://img.example.com/main-2.jpg',
            'https://img.example.com/main-3.jpg',
        ]);
        expect(result.sku_images).toEqual(['https://img.example.com/sku-1.png']);
        expect(result.detail_images).toEqual(['https://img.example.com/detail-1.jpg']);
        expect(result.videos).toEqual(['https://video.example.com/demo.mp4']);
        expect(result.main_count).toBe(3);
        expect(result.video_count).toBe(1);
    });
    it('normalizes media urls from style syntax and protocol-relative URLs', () => {
        expect(sharedTest.normalizeMediaUrl('url("//img.example.com/1.jpg")')).toBe('https://img.example.com/1.jpg');
        expect(sharedTest.normalizeMediaUrl('blob:https://detail.1688.com/1')).toBe('');
    });
});
