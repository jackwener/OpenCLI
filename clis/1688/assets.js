import { cli, Strategy } from '@jackwener/opencli/registry';
import { assertAuthenticatedState, buildDetailUrl, buildProvenance, cleanText, extractOfferId, gotoAndReadState, uniqueMediaSources, } from './shared.js';
// 1688 商品详情区位于自定义元素 v-detail-e 的 shadow DOM 内（懒渲染），
// 普通 CSS selector 无法穿透 shadowRoot，需沿 shadow host 链判断归属。
export const DETAIL_CONTAINER_SELECTOR = '.de-description-detail, #detailContentContainer, .html-description, .desc-lazyload-container';
export function inDetailContainer(el, selector = DETAIL_CONTAINER_SELECTOR) {
    let node = el;
    while (node) {
        // Check ancestors within the current root first: a detail container can
        // be a plain element inside a shadow root, not only the host itself.
        if (node.closest && node.closest(selector))
            return true;
        const rootNode = node.getRootNode ? node.getRootNode() : null;
        if (rootNode && rootNode.host) {
            const host = rootNode.host;
            if (host && host.matches && host.matches(selector))
                return true;
            node = host;
        }
        else {
            node = null;
        }
    }
    return false;
}
function scriptToReadAssets() {
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
      ];
      const detailContainerSelector = ${JSON.stringify(DETAIL_CONTAINER_SELECTOR)};
      // Inject the module-level implementation rather than hand-copying it, so
      // the unit tests exercise the same code that runs in the page.
      const inDetailContainerImpl = ${inDetailContainer.toString()};
      const inDetailContainer = (el) => inDetailContainerImpl(el, detailContainerSelector);
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

      // 详情区素材：全量收集 img/source（穿透 shadowRoot）+ host 链归属判断
      for (const element of [...queryAllDeep('img'), ...queryAllDeep('source')]) {
        if (!inDetailContainer(element)) continue;
        for (const value of valuesFromElement(element)) {
          push('image', 'detail', value, 'shadow:html-description');
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
function normalizeAssets(payload) {
    const offerId = cleanText(String(payload.offerId ?? '')) || extractOfferId(cleanText(payload.href)) || null;
    const itemUrl = offerId ? buildDetailUrl(offerId) : cleanText(payload.href);
    const seededAssets = [
        ...((payload.gallery?.mainImage ?? []).map((url) => ({ type: 'image', group: 'main', url, source: 'page_state:mainImage' }))),
        ...((payload.gallery?.offerImgList ?? []).map((url) => ({ type: 'image', group: 'main', url, source: 'page_state:offerImgList' }))),
        ...((payload.gallery?.wlImageInfos ?? []).map((item) => ({
            type: 'image',
            group: 'main',
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
async function readAssetsPayload(page, itemUrl) {
    const state = await gotoAndReadState(page, itemUrl, 2500, 'assets');
    assertAuthenticatedState(state, 'assets');
    // The detail section renders lazily inside a shadow root. Scroll once to the
    // bottom to trigger it, bring the container into view, then poll until the
    // deep detail-image count stops growing. autoScroll keeps no state across
    // calls, so calling it twice was identical to one longer call, and a fixed
    // page.wait(3) paid the full cost on every invocation even when the content
    // was already there.
    await page.autoScroll({ times: 6, delayMs: 500 });
    await page.evaluate(`(() => {
      const el = document.querySelector('.html-description, v-detail-e, .de-description-detail, #detailContentContainer');
      if (el) el.scrollIntoView({ behavior: 'instant', block: 'start' });
    })()`);
    await waitForDetailImages(page);
    return await page.evaluate(scriptToReadAssets());
}
/**
 * Poll until the detail-image count is stable across two reads (or the cap is
 * reached). Returns as soon as the content settles instead of always sleeping.
 */
async function waitForDetailImages(page, { attempts = 10, intervalSeconds = 0.5 } = {}) {
    const countJs = `(() => {
      const sel = ${JSON.stringify(DETAIL_CONTAINER_SELECTOR)};
      let total = 0;
      const walk = (root) => {
        for (const node of root.querySelectorAll('*')) {
          if (node.shadowRoot) walk(node.shadowRoot);
        }
        for (const host of root.querySelectorAll(sel)) {
          total += host.querySelectorAll('img, source').length;
          if (host.shadowRoot) total += host.shadowRoot.querySelectorAll('img, source').length;
        }
      };
      walk(document);
      return total;
    })()`;
    let previous = -1;
    for (let attempt = 0; attempt < attempts; attempt++) {
        let current = 0;
        try {
            current = Number(await page.evaluate(countJs)) || 0;
        }
        catch {
            return; // Reading the count is best-effort; fall through to extraction.
        }
        if (current > 0 && current === previous)
            return;
        previous = current;
        await page.wait(intervalSeconds);
    }
}
export async function extractAssetsForInput(page, input) {
    const itemUrl = buildDetailUrl(String(input ?? ''));
    const payload = await readAssetsPayload(page, itemUrl);
    return normalizeAssets(payload);
}
cli({
    site: '1688',
    name: 'assets',
    access: 'read',
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
    inDetailContainer,
    DETAIL_CONTAINER_SELECTOR,
};
