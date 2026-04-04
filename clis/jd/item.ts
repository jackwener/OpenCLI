/**
 * 京东商品详情 — browser cookie, DOM scraping + evaluate.
 *
 * 依赖: 需要在 Chrome 已登录京东
 * 用法: opencli jd item 100291143898
 */
import { cli, Strategy } from '../../registry.js';

function extractAvifImages(imageUrls: string[], maxImages: number): string[] {
  const unique = [...new Set(imageUrls.filter(Boolean))];
  return unique
    .filter((url) => url.includes('.avif') && url.includes('pcpubliccms'))
    .slice(0, maxImages);
}

cli({
  site: 'jd',
  name: 'item',
  description: '京东商品详情（价格、店铺、规格参数、AVIF 图片）',
  domain: 'item.jd.com',
  strategy: Strategy.COOKIE,
  args: [
    {
      name: 'sku',
      required: true,
      positional: true,
      help: '商品 SKU ID（如 100291143898）',
    },
    {
      name: 'images',
      type: 'int',
      default: 10,
      help: 'AVIF 图片数量上限（默认10）',
    },
  ],
  columns: ['title', 'price', 'shop', 'specs', 'avifImages'],
  func: async (page, kwargs) => {
    const sku = kwargs.sku;
    const maxImages = kwargs.images as number;
    const url = `https://item.jd.com/${sku}.html`;

    await page.goto(url, { waitUntil: 'load' });
    await page.wait(2);

    // 滚动加载商品详情区域中的延迟图片
    for (let i = 0; i < 6; i++) {
      await page.evaluate(`window.scrollTo(0, ${i * 2500})`);
      await page.wait(1);
    }
    await page.evaluate(`window.scrollTo(0, document.body.scrollHeight)`);
    await page.wait(2);

    const data = await page.evaluate(`
      (() => {
        const maxImg = ${maxImages};
        // 尝试多种价格选择器
        const skuMatch = location.pathname.match(/(\\d+)\\.html/);
        const sku = skuMatch ? skuMatch[1] : '';
        const priceEl = document.querySelector('.J-p-' + sku) ||
                        document.querySelector('[class*="price"] [class*="num"]') ||
                        document.querySelector('.p-price strong') ||
                        document.querySelector('.price.jd-price');
        const price = priceEl?.textContent?.trim() || 'not found';

        // 标题
        const title = document.querySelector('.product-title')?.textContent?.trim() ||
                      document.title.split('-')[0].trim();

        // 店铺
        const shop = document.querySelector('.J-shop-name')?.textContent?.trim() || '京东自营';

        // 所有图片
        const allImgs = Array.from(document.querySelectorAll('img[src*="360buyimg.com"]'));
        const srcs = allImgs.map(img => img.src).filter(Boolean);

        // 所有 avif 图片（去重，只保留 pcpubliccms CDN）
        const avifImages = ${extractAvifImages.toString()}(srcs, maxImg);

        // 规格参数：从页面文本提取
        const text = document.body.innerText;
        const specMatch = text.match(/商品编号[\\s\\S]*?(?=包装清单|\\n\\n|$)/);
        let specs = {};
        if (specMatch) {
          const lines = specMatch[0].split('\\n').filter(l => l.trim());
          for (let i = 0; i < lines.length - 1; i += 2) {
            const key = lines[i].trim();
            const val = lines[i + 1]?.trim() || '';
            if (key && val && key !== '商品编号') {
              specs[key] = val;
            }
          }
        }

        return { title, price, shop, specs, avifImages, totalImages: new Set(srcs).size };
      })()
    `);

    return [data];
  },
});

export const __test__ = {
  extractAvifImages,
};
