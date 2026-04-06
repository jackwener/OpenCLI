import { describe, expect, it } from 'vitest';
import { __test__ } from './download.js';

describe('1688 download helpers', () => {
  it('builds stable filenames for grouped assets', () => {
    const items = __test__.toDownloadItems('887904326744', {
      offer_id: '887904326744',
      title: '测试商品',
      item_url: 'https://detail.1688.com/offer/887904326744.html',
      main_images: ['https://img.example.com/a.jpg'],
      sku_images: ['https://img.example.com/b.png'],
      detail_images: ['https://img.example.com/c.webp'],
      videos: ['https://video.example.com/d.mp4'],
      other_images: [],
      raw_assets: [],
      source: [],
      main_count: 1,
      sku_count: 1,
      detail_count: 1,
      video_count: 1,
      source_url: 'https://detail.1688.com/offer/887904326744.html',
      fetched_at: new Date().toISOString(),
      strategy: 'cookie',
    });

    expect(items.map((item) => item.filename)).toEqual([
      '887904326744_main_01.jpg',
      '887904326744_sku_01.png',
      '887904326744_detail_01.webp',
      '887904326744_video_01.mp4',
    ]);
  });
});
