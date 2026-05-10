/**
 * 京东商品详情 — browser cookie, DOM scraping + evaluate.
 *
 * 依赖: 需要在 Chrome 已登录京东
 * 用法: opencli jd item 100291143898
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
function normalizePositiveInt(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}
function normalizeJdSkuInput(input) {
    const text = String(input || '').trim();
    const itemMatch = text.match(/item\.jd\.com\/(\d+)\.html/i);
    if (itemMatch)
        return itemMatch[1];
    if (/^\d+$/.test(text))
        return text;
    const paramMatch = text.match(/(?:skuId|sku|wareId|productId)[=:](\d+)/i);
    if (paramMatch)
        return paramMatch[1];
    return text;
}
function normalizeJdImageUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string')
        return '';
    let url = rawUrl.trim();
    if (!url)
        return '';
    if (url.startsWith('//'))
        url = `https:${url}`;
    if (!/^https?:\/\//.test(url))
        return '';
    return url;
}
function normalizeJdImageSize(url) {
    return normalizeJdImageUrl(url)
        .replace(/\/pcpubliccms\/s\d+x\d+_jfs\//, '/pcpubliccms/jfs/')
        .replace(/\/(n\d+)\/s\d+x\d+_jfs\//, '/$1/jfs/')
        .replace(/\/s\d+x\d+_jfs\//, '/jfs/');
}
function isJdMainImage(url) {
    const normalized = normalizeJdImageSize(url);
    return /360buyimg\.com\/(?:pcpubliccms|n\d+)\/jfs\//.test(normalized) &&
        !/\/(?:s\d+x\d+_|n\d\/s\d+x\d+_)/.test(normalized) &&
        !/\/(?:imgzone|sku|shaidan|popWaterMark|babel|jdcms|cms|ddimg|vc)\//.test(normalized);
}
function collectImageUrlsFrom(root, options = {}) {
    if (!root)
        return [];
    const urls = [];
    const ignoredContexts = '#spec-list, [class*="spec-list"], [class*="recommend"], [id*="recommend"], [class*="shaidan"], [id*="shaidan"], [class*="review"], [id*="review"], [class*="comment"], [id*="comment"], [class*="thumb"], [id*="thumb"], [class*="related"], [id*="related"]';
    const ignoreContexts = Boolean(options.ignoreContexts);
    const isIgnoredContext = (el) => {
        if (!ignoreContexts)
            return false;
        try {
            return !!el?.closest?.(ignoredContexts);
        }
        catch {
            return false;
        }
    };
    const pushUrlsFromText = (text) => {
        for (const match of String(text || '').matchAll(/url\(["']?([^"')]+360buyimg\.com[^"')]+)["']?\)/g)) {
            push(match[1]);
        }
    };
    const push = (value) => {
        const url = normalizeJdImageUrl(value);
        if (url && url.includes('360buyimg.com'))
            urls.push(url);
    };
    for (const img of root.querySelectorAll?.('img') || []) {
        if (isIgnoredContext(img))
            continue;
        push(img.currentSrc || img.src);
        push(img.getAttribute('data-src'));
        push(img.getAttribute('data-lazy-img'));
        push(img.getAttribute('data-lazyload'));
        push(img.getAttribute('data-original'));
    }
    for (const source of root.querySelectorAll?.('source') || []) {
        if (isIgnoredContext(source))
            continue;
        push(source.getAttribute('src'));
        push(source.getAttribute('srcset')?.split(/\s+/)[0]);
        push(source.getAttribute('data-src'));
        push(source.getAttribute('data-srcset')?.split(/\s+/)[0]);
    }
    for (const el of root.querySelectorAll?.('[style*="360buyimg.com"]') || []) {
        if (isIgnoredContext(el))
            continue;
        const style = el.getAttribute('style') || '';
        pushUrlsFromText(style);
    }
    if (typeof getComputedStyle === 'function') {
        const elements = [root, ...Array.from(root.querySelectorAll?.('*') || [])];
        for (const el of elements) {
            if (isIgnoredContext(el))
                continue;
            try {
                const style = getComputedStyle(el);
                pushUrlsFromText(style?.backgroundImage);
                pushUrlsFromText(style?.background);
            }
            catch {
                // ignore inaccessible/computed-style edge cases in the page context
            }
        }
    }
    return [...new Set(urls)];
}
function collectImageUrlsFromText(text) {
    const urls = [];
    const push = (value) => {
        const url = normalizeJdImageUrl(value);
        if (url && url.includes('360buyimg.com'))
            urls.push(url);
    };
    for (const match of String(text || '').matchAll(/(?:https?:)?\/\/[^"'`\s<>)\\]+360buyimg\.com[^"'`\s<>)\\]*/g)) {
        push(match[0]);
    }
    for (const match of String(text || '').matchAll(/url\(["']?([^"')]+360buyimg\.com[^"')]+)["']?\)/g)) {
        push(match[1]);
    }
    return urls;
}
function collectImageUrlsFromFramesAndScripts() {
    const urls = [];
    for (const script of document.scripts || []) {
        const text = script.textContent || '';
        if (!/360buyimg\.com/.test(text))
            continue;
        urls.push(...collectImageUrlsFromText(text));
    }
    for (const iframe of document.querySelectorAll('iframe')) {
        try {
            const frameDoc = iframe.contentDocument || iframe.contentWindow?.document;
            if (!frameDoc)
                continue;
            urls.push(...collectImageUrlsFrom(frameDoc.body || frameDoc.documentElement || frameDoc));
            for (const script of frameDoc.scripts || []) {
                const text = script.textContent || '';
                if (!/360buyimg\.com/.test(text))
                    continue;
                urls.push(...collectImageUrlsFromText(text));
            }
        }
        catch {
            // ignore cross-origin or not-yet-loaded iframe content
        }
    }
    return [...new Set(urls)];
}
function collectImageUrlsFromPayload(payload, seen = new Set(), depth = 0) {
    if (payload == null || depth > 4)
        return [];
    const urls = [];
    const push = (value) => {
        const url = normalizeJdImageUrl(value);
        if (url && url.includes('360buyimg.com'))
            urls.push(url);
    };
    if (typeof payload === 'string') {
        urls.push(...collectImageUrlsFromText(payload));
        return [...new Set(urls)];
    }
    if (typeof payload !== 'object')
        return [];
    if (seen.has(payload))
        return [];
    seen.add(payload);
    if (Array.isArray(payload)) {
        for (const item of payload)
            urls.push(...collectImageUrlsFromPayload(item, seen, depth + 1));
        return [...new Set(urls)];
    }
    for (const value of Object.values(payload)) {
        if (typeof value === 'string') {
            push(value);
            urls.push(...collectImageUrlsFromText(value));
            continue;
        }
        urls.push(...collectImageUrlsFromPayload(value, seen, depth + 1));
    }
    return [...new Set(urls)];
}
function collectImageUrlsFromPageDataObjects() {
    const urls = [];
    const keys = ['__NEXT_DATA__', '__NUXT__', '__INITIAL_STATE__', '__INITIAL_DATA__', '__APOLLO_STATE__', '__INITIAL_PROPS__', '__REDUX_STATE__', '__PAGE_DATA__', 'pageData', '__data__', 'detailData'];
    for (const key of keys) {
        try {
            if (typeof globalThis !== 'undefined' && key in globalThis) {
                urls.push(...collectImageUrlsFromPayload(globalThis[key]));
            }
        }
        catch {
            // ignore inaccessible globals
        }
    }
    return [...new Set(urls)];
}
async function collectImageUrlsFromNetworkResources() {
    const urls = [];
    const entries = typeof performance !== 'undefined' && typeof performance.getEntriesByType === 'function'
        ? performance.getEntriesByType('resource')
        : [];
    const candidates = [...new Set(entries
            .map((entry) => entry?.name)
            .filter((name) => typeof name === 'string' && /(?:jd\.com|360buyimg\.com)/.test(name) && /(?:detail|desc|ware|item|product|sku)/i.test(name) && !/pc_item_getWareGraphic/i.test(name)))].slice(0, 12);
    for (const url of candidates) {
        try {
            const resp = await fetch(url, { credentials: 'include' });
            if (!resp.ok)
                continue;
            const text = await resp.text();
            const contentType = resp.headers.get('content-type') || '';
            if (/json/i.test(contentType) || /^\s*[\[{]/.test(text)) {
                try {
                    urls.push(...collectImageUrlsFromPayload(JSON.parse(text)));
                    continue;
                }
                catch {
                    // fall back to text scanning
                }
            }
            urls.push(...collectImageUrlsFromText(text));
        }
        catch {
            // ignore request failures and cross-origin oddities
        }
    }
    return [...new Set(urls)];
}
function collectImageUrlsFromWareGraphicText(text) {
    let graphicContent = '';
    try {
        const payload = JSON.parse(String(text || ''));
        graphicContent = payload?.data?.graphicContent || payload?.graphicContent || '';
    }
    catch {
        graphicContent = String(text || '');
    }
    return [...new Set(collectImageUrlsFromText(graphicContent))];
}
async function collectImageUrlsFromWareGraphicResources(sku) {
    const urls = [];
    const entries = typeof performance !== 'undefined' && typeof performance.getEntriesByType === 'function'
        ? performance.getEntriesByType('resource')
        : [];
    const candidates = [...new Set(entries
            .map((entry) => entry?.name)
            .filter((name) => typeof name === 'string' && /pc_item_getWareGraphic/i.test(name)))];
    if (sku) {
        const body = encodeURIComponent(JSON.stringify({ skuId: String(sku) }));
        candidates.unshift(`https://api.m.jd.com/client.action?appid=item-v3&functionId=pc_item_getWareGraphic&client=pc&clientVersion=1.0.0&body=${body}`);
    }
    for (const url of candidates) {
        try {
            const resp = await fetch(url, { credentials: 'include' });
            if (!resp.ok)
                continue;
            urls.push(...collectImageUrlsFromWareGraphicText(await resp.text()));
        }
        catch {
            // ignore request failures and keep DOM/script fallbacks available
        }
    }
    return [...new Set(urls)];
}
async function collectImageUrlsFromFallbackSources() {
    return [
        ...collectImageUrlsFromPageDataObjects(),
        ...await collectImageUrlsFromNetworkResources(),
    ];
}
function isJdDetailImage(url) {
    const normalized = normalizeJdImageSize(url);
    return /360buyimg\.com\/(?:imgzone|skuimg|babel|jdcms|cms|popWaterMark|vc|ddimg)\//.test(normalized) &&
        !/\/shaidan\//.test(normalized) &&
        !/\/(?:s\d+x\d+_|n\d\/s\d+x\d+_|sku)\//.test(normalized);
}
function isJdWareGraphicDetailImage(url) {
    const raw = normalizeJdImageUrl(url);
    if (/\/(?:s\d+x\d+_|n\d\/s\d+x\d+_|sku\/s\d+x\d+_)jfs\//.test(raw))
        return false;
    const normalized = normalizeJdImageSize(url);
    return /360buyimg\.com\/sku\/jfs\//.test(normalized) &&
        !/\/shaidan\//.test(normalized);
}
function rankJdDetailImage(url) {
    const normalized = normalizeJdImageSize(url);
    if (/\.jpe?g(?:\.avif)?(?:$|[?#])/.test(normalized))
        return 0;
    if (/\.(?:png|webp)(?:\.avif)?(?:$|[?#])/.test(normalized))
        return 1;
    if (/\.gif(?:$|[?#])/.test(normalized))
        return 3;
    if (/\.avif(?:$|[?#])/.test(normalized))
        return 2;
    return 4;
}
function orderJdDetailImages(urls, options = {}) {
    const allowWareGraphicSku = Boolean(options.allowWareGraphicSku);
    return [...new Set(urls)]
        .filter((url) => isJdDetailImage(url) || (allowWareGraphicSku && isJdWareGraphicDetailImage(url)))
        .map((url, index) => ({ url, index, rank: rankJdDetailImage(url) }))
        .sort((a, b) => a.rank - b.rank || a.index - b.index)
        .map((item) => item.url);
}
function extractDetailImagesFromDom(maxImages) {
    const detailTitleParent = document.querySelector('#SPXQ-title')?.parentElement;
    const safeDetailTitleParent = detailTitleParent && detailTitleParent !== document.body && detailTitleParent !== document.documentElement
        ? detailTitleParent
        : null;
    const selectorRoots = [
        '#J-detail',
        '#J-detail-content',
        '#detail',
        '.detail',
        '.detail-content',
        '.detail-content-wrap',
        '.ssd-module-wrap',
        '#SPXQ-title + *',
    ];
    const scopedRoots = [
        safeDetailTitleParent,
        ...selectorRoots.flatMap((selector) => Array.from(document.querySelectorAll(selector))),
    ].filter((root) => root && root !== document.body && root !== document.documentElement);
    const scoped = [
        ...scopedRoots.flatMap((root) => collectImageUrlsFrom(root, { ignoreContexts: true })),
        ...collectImageUrlsFromFramesAndScripts(),
    ];
    return orderJdDetailImages(scoped).slice(0, maxImages);
}
async function extractDetailImagesFromPage(maxImages, sku) {
    const scoped = extractDetailImagesFromDom(maxImages);
    const fallback = await collectImageUrlsFromFallbackSources();
    const wareGraphic = await collectImageUrlsFromWareGraphicResources(sku);
    const regularImages = orderJdDetailImages([...scoped, ...fallback]);
    const wareGraphicImages = orderJdDetailImages(wareGraphic, { allowWareGraphicSku: true });
    return orderJdDetailImages([...regularImages, ...wareGraphicImages], { allowWareGraphicSku: true }).slice(0, maxImages);
}
function getJdDetailScrollSnapshot(maxImages) {
    const doc = document.scrollingElement || document.documentElement || document.body;
    const scrollY = window.scrollY || window.pageYOffset || doc?.scrollTop || 0;
    const viewportHeight = window.innerHeight || document.documentElement?.clientHeight || 0;
    const scrollHeight = Math.max(doc?.scrollHeight || 0, document.documentElement?.scrollHeight || 0, document.body?.scrollHeight || 0);
    return {
        detailImageCount: extractDetailImagesFromDom(maxImages).length,
        scrollY,
        viewportHeight,
        scrollHeight,
        nearBottom: scrollY + viewportHeight >= scrollHeight - 120,
    };
}
function scrollJdDetailStep() {
    const step = Math.max(900, Math.floor((window.innerHeight || 900) * 0.9));
    window.scrollBy(0, step);
    return step;
}
async function scrollJdDetailIntoView() {
    const tab = document.querySelector('#SPXQ-tab-column');
    const title = document.querySelector('#SPXQ-title');
    if (tab)
        tab.click();
    title?.scrollIntoView({ block: 'start' });
    const step = Math.max(900, Math.floor((window.innerHeight || 900) * 0.9));
    for (let i = 0; i < 2; i++) {
        window.scrollBy(0, step);
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
}
function extractMainImages(maxImages) {
    const roots = [
        document.querySelector('._gallery_116km_1'),
        ...Array.from(document.querySelectorAll('[class*="_gallery_"]')),
        document.querySelector('.preview-wrap'),
        document.querySelector('#spec-img')?.parentElement,
    ].filter(Boolean);
    const urls = roots.flatMap((root) => collectImageUrlsFrom(root).map(normalizeJdImageSize));
    return [...new Set(urls)]
        .filter(isJdMainImage)
        .slice(0, maxImages);
}
function extractAvifImages(imageUrls, maxImages) {
    const unique = [...new Set(imageUrls.map(normalizeJdImageSize).filter(Boolean))];
    return unique
        .filter((url) => url.includes('.avif') && isJdDetailImage(url))
        .slice(0, maxImages);
}
function extractPriceFromPayload(payload) {
    const items = Array.isArray(payload) ? payload : [];
    const item = items.find((entry) => entry && typeof entry === 'object');
    for (const key of ['p', 'op', 'm']) {
        const value = item?.[key];
        if (value && value !== '-1.00')
            return String(value);
    }
    return '';
}
function normalizePriceText(text) {
    const match = String(text || '').replace(/\s+/g, '').match(/(?:¥|￥)?(\d{2,7}(?:\.\d{1,2})?)/);
    return match ? match[1] : '';
}
function extractPriceFromDom(sku) {
    const selectors = [
        `.J-p-${sku}`,
        '[class*="price"] [class*="num"]',
        '[class*="price"]',
        '.p-price strong',
        '.price.jd-price',
    ];
    for (const selector of selectors) {
        for (const el of document.querySelectorAll(selector)) {
            const price = normalizePriceText(el.textContent || '');
            if (price)
                return price;
        }
    }
    for (const el of document.querySelectorAll('span, strong, div')) {
        const text = (el.textContent || '').trim();
        if (!/预售价|到手价|秒杀价|京东价|¥|￥/.test(text))
            continue;
        const direct = normalizePriceText(text);
        if (direct)
            return direct;
        const parentPrice = normalizePriceText(el.parentElement?.textContent || '');
        if (parentPrice)
            return parentPrice;
    }
    return '';
}
async function fetchJdPrice(sku) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    try {
        const resp = await fetch(`https://p.3.cn/prices/mgets?skuIds=J_${encodeURIComponent(sku)}&type=1`, {
            credentials: 'include',
            signal: controller.signal,
        });
        if (!resp.ok)
            return '';
        return extractPriceFromPayload(await resp.json());
    }
    catch {
        return '';
    }
    finally {
        clearTimeout(timeout);
    }
}
function extractSpecsFromText(text) {
    const specs = {};
    const lines = String(text || '').split('\n').map((line) => line.trim()).filter(Boolean);
    const allowedKeys = new Set(['品牌', '商品名称', '商品编号', '商品毛重', '商品产地', '货号', '类型', '能效等级', '洗涤容量', '烘干容量', '排水方式', '颜色', '型号', '系列', '系列品', '款式', '版本', '规格', '容量']);
    const setSpec = (key, val) => {
        const normalizedKey = String(key || '').trim().replace(/[：:]+$/, '');
        const normalizedVal = String(val || '').trim();
        if (!allowedKeys.has(normalizedKey))
            return;
        if (!normalizedVal || normalizedVal.length > 120)
            return;
        if (/^(服务|支付定金|加入购物车|立即购买|首页|购物车|我的|客服|品牌闪购|以旧换新)$/.test(normalizedVal))
            return;
        if (!specs[normalizedKey])
            specs[normalizedKey] = normalizedVal;
    };
    for (const line of lines) {
        const compactMatch = line.match(/^([^：:]{1,12})[：:]\s*(.{1,120})$/);
        if (compactMatch) {
            setSpec(compactMatch[1], compactMatch[2]);
            continue;
        }
    }
    for (let i = 0; i < lines.length - 1; i++) {
        const key = lines[i].replace(/[：:]+$/, '');
        const val = lines[i + 1];
        if (allowedKeys.has(key) && !allowedKeys.has(val)) {
            setSpec(key, val);
        }
    }
    return specs;
}
function extractSpecs() {
    const specs = {};
    const setSpec = (label, value) => {
        const normalizedLabel = String(label || '').trim().replace(/[：:]+$/, '');
        const normalizedValue = String(value || '').replace(/\s+/g, ' ').trim();
        if (!normalizedLabel || !normalizedValue)
            return;
        specs[normalizedLabel] = normalizedValue;
    };
    const selectedText = (root) => {
        const selected = root.querySelector('.specification-item-sku--selected, .specification-series-item--selected, .selected, [class*="selected"]');
        if (!selected)
            return '';
        return selected.querySelector('[class*="text"]')?.textContent?.trim() ||
            selected.textContent?.trim() ||
            selected.querySelector('img')?.getAttribute('alt')?.trim() ||
            '';
    };
    for (const el of document.querySelectorAll('.specification-series-layout')) {
        const label = el.querySelector('.layout-label')?.textContent?.trim();
        setSpec(label, selectedText(el));
    }
    for (const el of document.querySelectorAll('.specification-group')) {
        const label = el.querySelector('.specification-label, .specification-group-label, .label')?.textContent?.trim();
        setSpec(label, selectedText(el));
    }
    const attrsRoot = document.querySelector('#SPXQ-title')?.parentElement?.querySelector('.attrs') ||
        document.querySelector('#parameter2') ||
        document.querySelector('.Ptable');
    if (attrsRoot) {
        Object.assign(specs, extractSpecsFromText(attrsRoot.innerText || attrsRoot.textContent || ''));
    }
    return specs;
}
function detectJdPageState(expectedSku) {
    const href = location.href;
    const title = document.title || '';
    const bodyText = document.body?.innerText || document.body?.textContent || '';
    const hasProductMarker = Boolean(document.querySelector('.product-title, .sku-title, #spec-list, #J-detail, #SPXQ-title, [class*="_gallery_"]'));
    const text = `${title}\n${bodyText}`;
    const isLoginPage = /passport\.jd\.com|\/login\.aspx/.test(href) || /京东-欢迎登录|京东登录/.test(title);
    const hasSecurityChallenge = /risk_handler|安全验证|安全校验|完成安全验证|滑块|captcha|访问过于频繁|验证中心|京东验证/.test(`${href}\n${text}`);
    const loginOnlyWithoutProduct = /请登录|登录/.test(text) && !hasProductMarker;
    const looksBlocked = isLoginPage || hasSecurityChallenge || loginOnlyWithoutProduct;
    const onExpectedItemUrl = new RegExp(`item\.jd\.com/${expectedSku}\.html`).test(href);
    return {
        href,
        title,
        isProductPage: hasProductMarker && onExpectedItemUrl && !looksBlocked,
        hasProductMarker,
        onExpectedItemUrl,
        looksBlocked,
        isLoginPage,
        hasSecurityChallenge,
    };
}
cli({
    site: 'jd',
    name: 'item',
    access: 'read',
    description: '京东商品详情（价格、店铺、规格参数、主图、详情图）',
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
            default: 200,
            help: '图片数量上限（默认200）',
        },
    ],
    columns: ['title', 'price', 'shop', 'specs', 'mainImages', 'detailImages'],
    func: async (page, kwargs) => {
        const sku = normalizeJdSkuInput(kwargs.sku);
        const maxImages = normalizePositiveInt(kwargs.images, 200);
        const url = `https://item.jd.com/${sku}.html`;
        const currentHref = await page.evaluate(`location.href`).catch(() => '');
        if (!currentHref.includes(`item.jd.com/${sku}.html`)) {
            await page.goto(url, { waitUntil: 'load' });
            await page.wait(2);
        }
        const initialState = await page.evaluate(`(() => {
          const detectJdPageState = ${detectJdPageState.toString()};
          return detectJdPageState(${JSON.stringify(sku)});
        })()`).catch(() => null);
        if (!initialState?.looksBlocked) {
            await page.evaluate(`
              (async () => {
                const scrollJdDetailIntoView = ${scrollJdDetailIntoView.toString()};
                return scrollJdDetailIntoView();
              })()
            `);
            await page.wait(1.5);
            let previousDetailImageCount = -1;
            let stableRounds = 0;
            for (let i = 0; i < 30; i++) {
                const snapshot = await page.evaluate(`(() => {
                  const normalizeJdImageUrl = ${normalizeJdImageUrl.toString()};
                  const normalizeJdImageSize = ${normalizeJdImageSize.toString()};
                  const collectImageUrlsFrom = ${collectImageUrlsFrom.toString()};
                  const collectImageUrlsFromText = ${collectImageUrlsFromText.toString()};
                  const collectImageUrlsFromFramesAndScripts = ${collectImageUrlsFromFramesAndScripts.toString()};
                  const collectImageUrlsFromPayload = ${collectImageUrlsFromPayload.toString()};
                  const collectImageUrlsFromPageDataObjects = ${collectImageUrlsFromPageDataObjects.toString()};
                  const collectImageUrlsFromNetworkResources = ${collectImageUrlsFromNetworkResources.toString()};
                  const collectImageUrlsFromWareGraphicText = ${collectImageUrlsFromWareGraphicText.toString()};
                  const collectImageUrlsFromWareGraphicResources = ${collectImageUrlsFromWareGraphicResources.toString()};
                  const collectImageUrlsFromFallbackSources = ${collectImageUrlsFromFallbackSources.toString()};
                  const isJdDetailImage = ${isJdDetailImage.toString()};
                  const isJdWareGraphicDetailImage = ${isJdWareGraphicDetailImage.toString()};
                  const rankJdDetailImage = ${rankJdDetailImage.toString()};
                  const orderJdDetailImages = ${orderJdDetailImages.toString()};
                  const extractDetailImagesFromDom = ${extractDetailImagesFromDom.toString()};
                  const extractDetailImagesFromPage = ${extractDetailImagesFromPage.toString()};
                  const getJdDetailScrollSnapshot = ${getJdDetailScrollSnapshot.toString()};
                  const scrollJdDetailIntoView = ${scrollJdDetailIntoView.toString()};
                  if (document.querySelector('#SPXQ-title') && window.scrollY < 1000) {
                    return scrollJdDetailIntoView().then(() => getJdDetailScrollSnapshot(${maxImages}));
                  }
                  return getJdDetailScrollSnapshot(${maxImages});
                })()`).catch(() => null);
                if (!snapshot)
                    break;
                stableRounds = snapshot.detailImageCount === previousDetailImageCount ? stableRounds + 1 : 0;
                previousDetailImageCount = snapshot.detailImageCount;
                if (snapshot.nearBottom && stableRounds >= 2)
                    break;
                await page.evaluate(`(() => {
                  const scrollJdDetailStep = ${scrollJdDetailStep.toString()};
                  return scrollJdDetailStep();
                })()`);
                await page.wait(0.8);
            }
        }
        const data = await page.evaluate(`
      (async () => {
        const maxImg = ${maxImages};
        const normalizeJdImageUrl = ${normalizeJdImageUrl.toString()};
        const normalizeJdImageSize = ${normalizeJdImageSize.toString()};
        const isJdMainImage = ${isJdMainImage.toString()};
        const collectImageUrlsFrom = ${collectImageUrlsFrom.toString()};
        const collectImageUrlsFromText = ${collectImageUrlsFromText.toString()};
        const collectImageUrlsFromFramesAndScripts = ${collectImageUrlsFromFramesAndScripts.toString()};
        const collectImageUrlsFromPayload = ${collectImageUrlsFromPayload.toString()};
        const collectImageUrlsFromPageDataObjects = ${collectImageUrlsFromPageDataObjects.toString()};
        const collectImageUrlsFromNetworkResources = ${collectImageUrlsFromNetworkResources.toString()};
        const collectImageUrlsFromWareGraphicText = ${collectImageUrlsFromWareGraphicText.toString()};
        const collectImageUrlsFromWareGraphicResources = ${collectImageUrlsFromWareGraphicResources.toString()};
        const collectImageUrlsFromFallbackSources = ${collectImageUrlsFromFallbackSources.toString()};
        const isJdDetailImage = ${isJdDetailImage.toString()};
        const isJdWareGraphicDetailImage = ${isJdWareGraphicDetailImage.toString()};
        const rankJdDetailImage = ${rankJdDetailImage.toString()};
        const orderJdDetailImages = ${orderJdDetailImages.toString()};
        const extractMainImages = ${extractMainImages.toString()};
        const extractDetailImagesFromDom = ${extractDetailImagesFromDom.toString()};
        const extractDetailImagesFromPage = ${extractDetailImagesFromPage.toString()};
        const extractPriceFromPayload = ${extractPriceFromPayload.toString()};
        const fetchJdPrice = ${fetchJdPrice.toString()};
        const extractSpecsFromText = ${extractSpecsFromText.toString()};
        const extractSpecs = ${extractSpecs.toString()};
        const detectJdPageState = ${detectJdPageState.toString()};
        const pageState = detectJdPageState(${JSON.stringify(sku)});
        const normalizePriceText = ${normalizePriceText.toString()};
        const extractPriceFromDom = ${extractPriceFromDom.toString()};
        const apiPrice = await fetchJdPrice(${JSON.stringify(sku)});
        const domPrice = extractPriceFromDom(${JSON.stringify(sku)});
        const price = apiPrice || domPrice || 'not found';

        const title = document.querySelector('.product-title')?.textContent?.trim() ||
                      document.querySelector('.sku-title')?.textContent?.trim() ||
                      document.title.split('-')[0].trim();

        const shop = document.querySelector('.J-shop-name')?.textContent?.trim() ||
                     document.querySelector('.top-name')?.textContent?.trim() ||
                     document.querySelector('[class*="shop"] [class*="name"]')?.textContent?.trim() ||
                     '京东自营';

        const allImgs = Array.from(document.querySelectorAll('img[src*="360buyimg.com"]'));
        const srcs = allImgs.map(img => img.src).filter(Boolean);

        const mainImages = extractMainImages(maxImg);
        const detailImages = await extractDetailImagesFromPage(maxImg, ${JSON.stringify(sku)});
        const specs = extractSpecs();

        const result = { title, price, shop, specs, mainImages, detailImages, totalImages: new Set(srcs).size, pageState };
        if (!pageState.isProductPage) {
          result.error = pageState.looksBlocked
            ? 'JD page is blocked by login/security verification'
            : 'JD product page was not loaded';
          result.pageState = pageState;
        }
        return result;
      })()
    `);
        if (data?.error) {
            if (data?.pageState?.looksBlocked) {
                throw new AuthRequiredError('item.jd.com', data.error);
            }
            throw new CommandExecutionError(data.error);
        }
        if (maxImages > 0 && data?.pageState?.isProductPage && (!Array.isArray(data.detailImages) || data.detailImages.length === 0)) {
            throw new CommandExecutionError('JD item detail images were not found', 'The product page loaded, but no detail images were detected from DOM, scripts, frames, page data, or WareGraphic fallback.');
        }
        return [data];
    },
});
export const __test__ = {
    normalizePositiveInt,
    normalizeJdSkuInput,
    normalizeJdImageUrl,
    normalizeJdImageSize,
    isJdMainImage,
    collectImageUrlsFrom,
    collectImageUrlsFromText,
    collectImageUrlsFromFramesAndScripts,
    collectImageUrlsFromPayload,
    collectImageUrlsFromPageDataObjects,
    collectImageUrlsFromNetworkResources,
    collectImageUrlsFromWareGraphicText,
    collectImageUrlsFromWareGraphicResources,
    collectImageUrlsFromFallbackSources,
    isJdDetailImage,
    isJdWareGraphicDetailImage,
    rankJdDetailImage,
    orderJdDetailImages,
    getJdDetailScrollSnapshot,
    scrollJdDetailStep,
    extractMainImages,
    extractDetailImagesFromDom,
    extractDetailImagesFromPage,
    extractAvifImages,
    extractPriceFromPayload,
    normalizePriceText,
    extractPriceFromDom,
    extractSpecsFromText,
    extractSpecs,
    detectJdPageState,
};
