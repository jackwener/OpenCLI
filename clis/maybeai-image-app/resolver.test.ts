import { describe, expect, it } from 'vitest';
import { getApp, toWorkflowVariables } from './catalog.js';
import { resolveImageAppInput } from './resolver.js';

describe('maybeai-image-app resolver', () => {
  it('keeps shell-supported count for details-selling-points and normalizes legacy dataframe rows', () => {
    const resolved = resolveImageAppInput('details-selling-points', {
      product_and_attrs: [
        {
          product_image_url: 'https://example.com/product.jpg',
          attr_image_urls: ['https://example.com/attr1.jpg'],
        },
      ],
      ratio: '1:1',
      count: 4,
    });

    expect(resolved.input).toEqual({
      product_and_attrs: [
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
      ],
      ratio: '1:1',
      count: 4,
    });
    expect(resolved.variables).toEqual(
      expect.arrayContaining([
        {
          name: 'variable:scalar:image_count',
          default_value: 4,
        },
      ]),
    );
    expect(resolved.variables).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'variable:scalar:llm_model' }),
      ]),
    );
  });

  it('drops unsupported fields for apps that do not expose them in shell', () => {
    const resolved = resolveImageAppInput('remove-background', {
      products: ['https://example.com/a.jpg'],
      count: 1,
      foo: 'bar',
    });

    expect(resolved.input).toEqual({
      products: ['https://example.com/a.jpg'],
    });
    expect(resolved.variables).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'variable:scalar:image_count' }),
      ]),
    );
    expect(resolved.warnings).toContain('Dropped unsupported input fields for remove-background: count, foo');
  });

  it('normalizes legacy detail dataframe rows before workflow variable mapping as a final safeguard', () => {
    const variables = toWorkflowVariables(getApp('details-selling-points'), {
      product_and_attrs: [
        {
          product_image_url: 'https://example.com/product.jpg',
          attr_image_urls: ['https://example.com/attr1.jpg'],
        },
      ],
      ratio: '1:1',
    });

    expect(variables).toEqual([
      {
        name: 'variable:dataframe:product_image_url',
        default_value: [
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
        ],
      },
      {
        name: 'variable:scalar:aspect_ratio',
        default_value: '1:1',
      },
    ]);
  });

  it('normalizes string-array product_and_attrs input into shell structured-image format', () => {
    const resolved = resolveImageAppInput('gen-details', {
      product_and_attrs: ['https://example.com/product.jpg'],
      platform: 'Shopee',
      market: 'Southeast Asia',
    });

    expect(resolved.input).toEqual({
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
    expect(resolved.variables).toEqual(
      expect.arrayContaining([
        {
          name: 'variable:dataframe:product_image_url',
          default_value: [
            {
              image_type: 'product_image_url',
              url: 'https://example.com/product.jpg',
              description: '商品图片',
            },
          ],
        },
      ]),
    );
  });

  it('normalizes legacy size-compare dataframe rows into shell structured-image format', () => {
    const resolved = resolveImageAppInput('gen-size-compare', {
      product_and_size_chart: [
        {
          product_image_url: 'https://example.com/product.jpg',
          reference_image_url: 'https://example.com/size-chart.jpg',
        },
      ],
      ratio: '1:1',
    });

    expect(resolved.input).toEqual({
      product_and_size_chart: [
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
      ],
      ratio: '1:1',
    });
    expect(resolved.variables).toEqual([
      {
        name: 'variable:dataframe:product_image_url',
        default_value: [
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
        ],
      },
      {
        name: 'variable:scalar:aspect_ratio',
        default_value: '1:1',
      },
    ]);
  });

  it('normalizes string-array size-compare input into shell structured-image format', () => {
    const resolved = resolveImageAppInput('gen-size-compare', {
      product_and_size_chart: ['https://example.com/product.jpg', 'https://example.com/size-chart.jpg'],
      ratio: '1:1',
    });

    expect(resolved.input).toEqual({
      product_and_size_chart: [
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
      ],
      ratio: '1:1',
    });
  });

  it('normalizes single-product apps from products arrays as a fallback', () => {
    const resolved = resolveImageAppInput('change-background', {
      products: ['https://example.com/product.jpg'],
      scene: 'https://example.com/scene.jpg',
    });

    expect(resolved.input).toEqual({
      product: 'https://example.com/product.jpg',
      scene: 'https://example.com/scene.jpg',
    });
  });
});
