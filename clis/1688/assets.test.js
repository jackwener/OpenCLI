import { describe, expect, it } from 'vitest';
import { __test__ } from './assets.js';
import { __test__ as sharedTest } from './shared.js';
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
