import { cli, Strategy } from '@jackwener/opencli/registry';
import type { IPage } from '@jackwener/opencli/types';
import {
  assertAuthenticatedState,
  buildDetailUrl,
  buildProvenance,
  cleanText,
  extractOfferId,
  gotoAndReadState,
  type MediaSource,
  uniqueMediaSources,
} from './shared.js';

interface AssetBrowserPayload {
  href?: string;
  title?: string;
  offerTitle?: string;
  offerId?: string | number;
  gallery?: {
    mainImage?: string[];
    offerImgList?: string[];
    wlImageInfos?: Array<{ fullPathImageURI?: string }>;
    [key: string]: unknown;
  };
  scannedAssets?: MediaSource[];
}

export interface Normalized1688Assets {
  offer_id: string | null;
  title: string | null;
  item_url: string;
  main_images: string[];
  sku_images: string[];
  detail_images: string[];
  videos: string[];
  other_images: string[];
  raw_assets: MediaSource[];
  source: string[];
  main_count: number;
  sku_count: number;
  detail_count: number;
  video_count: number;
  source_url: string;
  fetched_at: string;
  strategy: string;
}

function scriptToReadAssets(): string {
  return `
    (() => {
      const root = window.context ?? {};
      const model = root.result?.global?.globalData?.model ?? null;
      const gallery = root.result?.data?.gallery?.fields ?? null;
      const defaultSrcProps = ['data-lazyload-src', 'data-src', 'data-ks-lazyload', 'currentSrc', 'src'];
      const groups = [
        { key: 'main', type: 'image', selectors: ['#dt-tab img', '.detail-gallery-turn img.detail-gallery-img', '.img-list-wrapper img.od-gallery-img', '.od-scroller-item span'] },
        { key: 'video', type: 'video', selectors: ['.lib-video video', 'video[src]', 'video source[src]'] },
        { key: 'sku', type: 'image', selectors: ['.pc-sku-wrapper .prop-item-inner-wrapper', '.sku-item-wrapper', '.specification-cell', '.sku-filter-button', '.expand-view-item', '.feature-item img'], srcProps: ['backgroundImage'] },
        { key: 'detail', type: 'image', selectors: ['.de-description-detail img', '#detailContentContainer img', '.html-description img', '.html-description source', '.desc-lazyload-container img'] },
      ];
      const assets = [];
      const seen = new Set();

      const normalizeUrl = (value) => {
        if (typeof value !== 'string') return '';
        let next = value
          .replace(/^url\\((.*)\\)$/i, '$1')
          .replace(/^['"]|['"]$/g, '')
          .replace(/\\\\u002F/g, '/')
          .replace(/&amp;/g, '&')
          .trim();
        if (!next || next.startsWith('blob:') || next.startsWith('data:')) return '';
        if (next.startsWith('//')) next = 'https:' + next;
        try {
          return new URL(next, location.href).toString();
        } catch {
          return '';
        }
      };

      const push = (type, group, url, source) => {
        const normalized = normalizeUrl(url);
        if (!normalized) return;
        const key = type + ':' + normalized;
        if (seen.has(key)) return;
        seen.add(key);
        assets.push({ type, group, url: normalized, source });
      };

      const queryAllDeep = (selector) => {
        const results = [];
        const visitedRoots = new Set();
        const walkRoots = (root, fn) => {
          if (!root || visitedRoots.has(root)) return;
          visitedRoots.add(root);
          fn(root);
          const childElements = root.querySelectorAll ? Array.from(root.querySelectorAll('*')) : [];
          for (const child of childElements) {
            if (child && child.shadowRoot) {
              walkRoots(child.shadowRoot, fn);
            }
          }
        };
        walkRoots(document, (root) => {
          if (root.querySelectorAll) {
            results.push(...Array.from(root.querySelectorAll(selector)));
          }
        });
        return results;
      };

      const valuesFromElement = (element, srcProps) => {
        const values = [];
        const props = srcProps && srcProps.length ? srcProps : defaultSrcProps;
        for (const prop of props) {
          try {
            if (prop === 'backgroundImage') {
              const bg = getComputedStyle(element).backgroundImage || '';
              const matches = bg.match(/url\\(([^)]+)\\)/g) || [];
              for (const match of matches) {
                const clean = match.replace(/^url\\(/, '').replace(/\\)$/, '');
                values.push(clean);
              }
              continue;
            }

            const direct = element[prop];
            if (typeof direct === 'string' && direct) values.push(direct);
            const attr = element.getAttribute ? element.getAttribute(prop) : '';
            if (attr) values.push(attr);
          } catch {}
        }

        if (element.tagName === 'SOURCE' && element.parentElement?.tagName === 'VIDEO') {
          values.push(element.src || element.getAttribute('src') || '');
        }

        if (element.tagName === 'VIDEO') {
          values.push(element.currentSrc || '');
          values.push(element.src || '');
        }

        return values;
      };

      for (const group of groups) {
        for (const selector of group.selectors) {
          for (const element of queryAllDeep(selector)) {
            for (const value of valuesFromElement(element, group.srcProps)) {
              push(group.type, group.key, value, 'dom:' + selector);
            }
          }
        }
      }

      const scriptTexts = Array.from(document.scripts).map((script) => script.textContent || '');
      const videoRegex = /https?:\\/\\/[^"'\\s]+\\.(?:mp4|m3u8)(?:\\?[^"'\\s]*)?/gi;
      for (const scriptText of scriptTexts) {
        const matches = scriptText.match(videoRegex) || [];
        for (const match of matches) {
          push('video', 'video', match, 'script');
        }
      }

      const toJson = (value) => JSON.parse(JSON.stringify(value ?? null));
      return {
        href: window.location.href,
        title: document.title || '',
        offerTitle: model?.offerTitleModel?.subject ?? '',
        offerId: model?.tradeModel?.offerId ?? '',
        gallery: toJson(gallery),
        scannedAssets: assets,
      };
    })()
  `;
}

function normalizeAssets(payload: AssetBrowserPayload): Normalized1688Assets {
  const offerId = cleanText(String(payload.offerId ?? '')) || extractOfferId(cleanText(payload.href)) || null;
  const itemUrl = offerId ? buildDetailUrl(offerId) : cleanText(payload.href);
  const seededAssets: MediaSource[] = [
    ...((payload.gallery?.mainImage ?? []).map((url) => ({ type: 'image' as const, group: 'main' as const, url, source: 'page_state:mainImage' }))),
    ...((payload.gallery?.offerImgList ?? []).map((url) => ({ type: 'image' as const, group: 'main' as const, url, source: 'page_state:offerImgList' }))),
    ...((payload.gallery?.wlImageInfos ?? []).map((item) => ({
      type: 'image' as const,
      group: 'main' as const,
      url: item?.fullPathImageURI ?? '',
      source: 'page_state:wlImageInfos',
    }))),
  ];

  const assets = uniqueMediaSources([...seededAssets, ...(payload.scannedAssets ?? [])]);

  const mainImages = assets.filter((item) => item.type === 'image' && item.group === 'main').map((item) => item.url);
  const skuImages = assets.filter((item) => item.type === 'image' && item.group === 'sku').map((item) => item.url);
  const detailImages = assets.filter((item) => item.type === 'image' && item.group === 'detail').map((item) => item.url);
  const videos = assets.filter((item) => item.type === 'video').map((item) => item.url);
  const otherImages = assets
    .filter((item) => item.type === 'image' && !['main', 'sku', 'detail'].includes(item.group))
    .map((item) => item.url);

  return {
    offer_id: offerId,
    title: cleanText(payload.offerTitle) || cleanText(payload.title) || null,
    item_url: itemUrl,
    main_images: mainImages,
    sku_images: skuImages,
    detail_images: detailImages,
    videos,
    other_images: otherImages,
    raw_assets: assets,
    source: [...new Set(assets.map((item) => cleanText(item.source)).filter(Boolean))],
    main_count: mainImages.length,
    sku_count: skuImages.length,
    detail_count: detailImages.length,
    video_count: videos.length,
    ...buildProvenance(cleanText(payload.href) || itemUrl),
  };
}

async function readAssetsPayload(page: IPage, itemUrl: string): Promise<AssetBrowserPayload> {
  const state = await gotoAndReadState(page, itemUrl, 2500, 'assets');
  assertAuthenticatedState(state, 'assets');
  await page.autoScroll({ times: 3, delayMs: 400 });
  await page.wait(1);
  return await page.evaluate(scriptToReadAssets()) as AssetBrowserPayload;
}

export async function extractAssetsForInput(page: IPage, input: string): Promise<Normalized1688Assets> {
  const itemUrl = buildDetailUrl(String(input ?? ''));
  const payload = await readAssetsPayload(page, itemUrl);
  return normalizeAssets(payload);
}

cli({
  site: '1688',
  name: 'assets',
  description: '列出 1688 商品页可提取的图片/视频素材',
  domain: 'www.1688.com',
  strategy: Strategy.COOKIE,
  args: [
    {
      name: 'input',
      required: true,
      positional: true,
      help: '1688 商品 URL 或 offer ID（如 887904326744）',
    },
  ],
  columns: ['offer_id', 'title', 'main_count', 'sku_count', 'detail_count', 'video_count'],
  func: async (page, kwargs) => {
    return [await extractAssetsForInput(page, String(kwargs.input ?? ''))];
  },
});

export const __test__ = {
  normalizeAssets,
};
