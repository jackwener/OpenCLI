import { describe, expect, it } from 'vitest';
import { buildImageAppPlan } from './planner.js';

describe('maybeai-image-app planner', () => {
  it('builds replica-listing-image structured input from dedicated flags', () => {
    const plan = buildImageAppPlan(['给这个商品做参考生套图'], {
      app: 'replica-listing-image',
      'product-images': 'https://example.com/front.jpg,https://example.com/side.jpg',
      'reference-images': 'https://example.com/template.jpg',
      platform: 'Amazon',
      market: 'North America',
    });

    expect(plan.selectedApp).toBe('replica-listing-image');
    expect(plan.missingFields).toEqual([]);
    expect(plan.input).toMatchObject({
      reference_images: ['https://example.com/template.jpg'],
      platform: 'Amazon',
      market: 'North America',
    });
    expect(plan.input.product_images).toEqual([
      { image_type: 'front', url: 'https://example.com/front.jpg' },
      { image_type: 'side', url: 'https://example.com/side.jpg' },
    ]);
  });

  it('builds gen-image-set module counts from flags', () => {
    const plan = buildImageAppPlan(['生成商品套图'], {
      app: 'gen-image-set',
      products: 'https://example.com/product.jpg',
      'white-bg-count': '1',
      'scene-count': '2',
      'selling-point-count': '2',
      'detail-count': '2',
      platform: 'Amazon',
      market: 'North America',
    });

    expect(plan.selectedApp).toBe('gen-image-set');
    expect(plan.missingFields).toEqual([]);
    expect(plan.input).toMatchObject({
      products: ['https://example.com/product.jpg'],
      white_bg_count: 1,
      scene_count: 2,
      selling_point_count: 2,
      detail_count: 2,
      platform: 'Amazon',
      market: 'North America',
    });
  });

  it('detects gen-image-set from product image set intent', () => {
    const plan = buildImageAppPlan(['给这个商品生成标准商品套图'], {
      products: 'https://example.com/product.jpg',
    });

    expect(plan.selectedApp).toBe('gen-image-set');
    expect(plan.input.preset).toBe('standard');
  });

  it('builds gen-reference structured inputs from product and reference flags', () => {
    const plan = buildImageAppPlan(['按参考图生成一张新图'], {
      app: 'gen-reference',
      'product-images': 'https://example.com/product-front.jpg,https://example.com/product-back.jpg',
      'reference-images': 'https://example.com/ref-color.jpg,https://example.com/ref-model.jpg,https://example.com/ref-scene.jpg',
      prompt: '保留卖点，参考模特与场景',
    });

    expect(plan.selectedApp).toBe('gen-reference');
    expect(plan.missingFields).toEqual([]);
    expect(plan.input.prompt).toBe('保留卖点，参考模特与场景');
    expect(plan.input.product_images).toEqual([
      { image_type: 'front_image', url: 'https://example.com/product-front.jpg' },
      { image_type: 'back_image', url: 'https://example.com/product-back.jpg' },
    ]);
    expect(plan.input.reference_images).toEqual([
      { image_type: 'reference_color_image', url: 'https://example.com/ref-color.jpg' },
      { image_type: 'reference_modle_image', url: 'https://example.com/ref-model.jpg' },
      { image_type: 'reference_scene_image', url: 'https://example.com/ref-scene.jpg' },
    ]);
  });

  it('detects reference-generation intent from natural language', () => {
    const plan = buildImageAppPlan(['用这张商品图参考生图'], {
      'product-images': 'https://example.com/product.jpg',
      'reference-images': 'https://example.com/ref.jpg',
    });

    expect(plan.selectedApp).toBe('gen-reference');
    expect(plan.candidates[0]?.app).toBe('gen-reference');
  });

  it('builds details-selling-points input using shell structured-image format', () => {
    const plan = buildImageAppPlan(['给这个商品生成卖点图'], {
      app: 'details-selling-points',
      product: 'https://example.com/product.jpg',
      attrs: 'https://example.com/attr1.jpg,https://example.com/attr2.jpg',
    });

    expect(plan.selectedApp).toBe('details-selling-points');
    expect(plan.missingFields).toEqual([]);
    expect(plan.input.product_and_attrs).toEqual([
      {
        image_type: 'product_image_url',
        url: 'https://example.com/product.jpg',
        description: '商品图片',
      },
      {
        image_type: 'product_attribute_url',
        url: 'https://example.com/attr1.jpg',
        description: '商品属性图片',
      },
      {
        image_type: 'product_attribute_url',
        url: 'https://example.com/attr2.jpg',
        description: '商品属性图片',
      },
    ]);
  });

  it('normalizes legacy product_and_attrs objects into shell structured-image format', () => {
    const plan = buildImageAppPlan(['给这个商品生成卖点图'], {
      app: 'details-selling-points',
      input: JSON.stringify({
        product_and_attrs: [
          {
            product_image_url: 'https://example.com/product.jpg',
            attr_image_urls: ['https://example.com/attr1.jpg'],
          },
        ],
      }),
    });

    expect(plan.input.product_and_attrs).toEqual([
      {
        image_type: 'product_image_url',
        url: 'https://example.com/product.jpg',
        description: '商品图片',
      },
      {
        image_type: 'product_attribute_url',
        url: 'https://example.com/attr1.jpg',
        description: '商品属性图片',
      },
    ]);
  });

  it('does not leak image_group_type into gen-details when intent contains detail keywords', () => {
    const plan = buildImageAppPlan(['gen-details'], {
      app: 'gen-details',
      input: JSON.stringify({
        product_and_attrs: ['https://example.com/product.jpg'],
        platform: 'Shopee',
        market: 'Southeast Asia',
      }),
    });

    expect(plan.missingFields).toEqual([]);
    expect(plan.input).toEqual({
      product_and_attrs: [
        {
          image_type: 'product_image_url',
          url: 'https://example.com/product.jpg',
          description: '商品图片',
        },
      ],
      platform: 'Shopee',
      market: 'Southeast Asia',
    });
  });

  it('builds gen-details input from --products when only a single product image is provided', () => {
    const plan = buildImageAppPlan(['gen-details'], {
      app: 'gen-details',
      products: 'https://example.com/product.jpg',
      platform: 'Shopee',
      market: 'Southeast Asia',
    });

    expect(plan.missingFields).toEqual([]);
    expect(plan.input).toEqual({
      product_and_attrs: [
        {
          image_type: 'product_image_url',
          url: 'https://example.com/product.jpg',
          description: '商品图片',
        },
      ],
      platform: 'Shopee',
      market: 'Southeast Asia',
    });
  });

  it('builds single-product apps from --products by taking the first image as product', () => {
    const plan = buildImageAppPlan(['换场景'], {
      app: 'change-background',
      products: 'https://example.com/product.jpg',
      scene: 'https://example.com/scene.jpg',
    });

    expect(plan.missingFields).toEqual([]);
    expect(plan.input).toEqual({
      product: 'https://example.com/product.jpg',
      scene: 'https://example.com/scene.jpg',
    });
  });

  it('builds gen-size-compare from --products plus --size-chart', () => {
    const plan = buildImageAppPlan(['尺码对比图'], {
      app: 'gen-size-compare',
      products: 'https://example.com/product.jpg',
      'size-chart': 'https://example.com/size-chart.jpg',
    });

    expect(plan.missingFields).toEqual([]);
    expect(plan.input.product_and_size_chart).toEqual([
      {
        image_type: 'product_image_url',
        url: 'https://example.com/product.jpg',
        description: '商品图片',
      },
      {
        image_type: 'product_attribute_url',
        url: 'https://example.com/size-chart.jpg',
        description: '商品属性图片',
      },
    ]);
  });
});
