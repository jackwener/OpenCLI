import { describe, expect, it } from 'vitest';
import { buildVideoAppPlan } from './planner.js';

describe('maybeai-video-app planner', () => {
  it('selects video-remake for reference video intent', () => {
    const plan = buildVideoAppPlan(['翻拍这个参考视频 https://example.com/product.png https://example.com/ref.mp4'], {});
    expect(plan.selectedApp).toBe('video-remake');
    expect(plan.input.product).toBe('https://example.com/product.png');
    expect(plan.input.reference_video).toBe('https://example.com/ref.mp4');
  });

  it('selects image-to-video for motion intent', () => {
    const plan = buildVideoAppPlan(['让这张图动起来 https://example.com/image.png'], {});
    expect(plan.selectedApp).toBe('image-to-video');
    expect(plan.input.image).toBe('https://example.com/image.png');
  });

  it('selects ugc app for ugc keyword', () => {
    const plan = buildVideoAppPlan(['给这个耳机生成一条 UGC 种草视频 https://example.com/product.png'], {});
    expect(plan.selectedApp).toBe('ugc-ad-video');
    expect(plan.input.product).toBe('https://example.com/product.png');
  });

  it('uses first product image from flags', () => {
    const plan = buildVideoAppPlan(['生成商品视频'], {
      'product-images': 'https://example.com/a.png,https://example.com/b.png',
      platform: 'TikTokShop',
    });
    expect(plan.selectedApp).toBe('product-ad-video');
    expect(plan.input.product).toBe('https://example.com/a.png');
    expect(plan.input.platform).toBe('TikTokShop');
  });
});
