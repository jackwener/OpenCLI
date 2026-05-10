import { CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { FACTORY_BADGE_PATTERNS, SERVICE_BADGE_PATTERNS, assertAuthenticatedState, buildDetailUrl, buildProvenance, canonicalizeSellerUrl, canonicalizeStoreUrl, cleanMultilineText, cleanText, extractAddress, extractBadges, extractMemberId, extractMetric, extractOfferId, extractShopId, extractYearsOnPlatform, gotoAndReadState, guessTopCategories, resolveStoreUrl, uniqueNonEmpty, } from './shared.js';
function normalizeStorePayload(input) {
    const storePayload = input.storePayload;
    const contactPayload = input.contactPayload;
    const seed = input.seed;
    const contactText = cleanMultilineText(contactPayload?.bodyText);
    const storeText = cleanMultilineText(storePayload?.bodyText);
    const seedText = cleanMultilineText(seed?.bodyText);
    const combinedText = [contactText, storeText, seedText].filter(Boolean).join('\n');
    const sellerUrlRaw = cleanText(seed?.seller?.winportUrl
        ?? seed?.seller?.sellerWinportUrlMap?.defaultUrl
        ?? storePayload?.href
        ?? input.resolvedUrl);
    const storeUrl = safeCanonicalStoreUrl(sellerUrlRaw || input.resolvedUrl) ?? input.resolvedUrl;
    const sellerUrl = canonicalizeSellerUrl(sellerUrlRaw) ?? storeUrl;
    const companyUrl = pickCompanyUrl(contactPayload?.href, storeUrl);
    const memberId = cleanText(seed?.seller?.memberId)
        || input.explicitMemberId
        || extractMemberId(input.resolvedUrl)
        || extractMemberId(storePayload?.href ?? '')
        || null;
    const shopId = extractShopId(sellerUrl) ?? extractShopId(storeUrl);
    const companyName = cleanText(seed?.seller?.companyName)
        || firstNamedLine(contactText)
        || firstNamedLine(storeText)
        || null;
    const serviceBadges = uniqueNonEmpty([
        ...extractBadges(combinedText, SERVICE_BADGE_PATTERNS),
        ...((seed?.services ?? []).map((service) => cleanText(service.serviceName))),
    ]);
    const factoryBadges = extractBadges(combinedText, FACTORY_BADGE_PATTERNS);
    return {
        member_id: memberId,
        shop_id: shopId,
        store_name: companyName,
        store_url: storeUrl,
        company_name: companyName,
        company_url: companyUrl,
        business_model_text: firstMetric(combinedText, ['经营模式', '生产加工', '主营产品']),
        years_on_platform_text: extractYearsOnPlatform(combinedText),
        location: extractAddress(contactText) ?? extractAddress(storeText),
        staff_size_text: firstMetric(combinedText, ['员工人数', '员工总数']),
        factory_badges: factoryBadges,
        service_badges: serviceBadges,
        response_rate_text: firstMetric(combinedText, ['响应率', '回复率', '响应速度']),
        return_rate_text: extractReturnRate(combinedText),
        top_categories: guessTopCategories(combinedText),
        phone_text: extractMetric(contactText, '电话'),
        mobile_text: extractMetric(contactText, '手机'),
        ...buildProvenance(cleanText(contactPayload?.href) || cleanText(storePayload?.href) || input.resolvedUrl),
    };
}
function safeCanonicalStoreUrl(url) {
    try {
        return canonicalizeStoreUrl(url);
    }
    catch {
        return null;
    }
}
function pickCompanyUrl(contactHref, storeUrl) {
    const fromPage = cleanText(contactHref);
    if (fromPage) {
        const normalized = buildContactUrl(fromPage);
        if (normalized)
            return normalized;
    }
    return buildContactUrl(storeUrl);
}
function buildContactUrl(storeUrl) {
    try {
        const parsed = new URL(storeUrl);
        if (!parsed.hostname.endsWith('.1688.com'))
            return null;
        return `${parsed.protocol}//${parsed.hostname}/page/contactinfo.html`;
    }
    catch {
        return null;
    }
}
function firstNamedLine(text) {
    return text
        .split('\n')
        .map((line) => cleanText(line))
        .find((line) => line.includes('有限公司') || line.includes('商行') || line.includes('工厂'))
        ?? null;
}
function firstMetric(text, labels) {
    for (const label of labels) {
        const value = extractMetric(text, label);
        if (value)
            return value;
    }
    return null;
}
function extractReturnRate(text) {
    const inline = text.match(/回头率\s*([0-9.]+%)/);
    if (inline)
        return cleanText(inline[0]);
    const multiline = text.match(/回头率\s*\n\s*([0-9.]+%)/);
    if (!multiline)
        return null;
    return `回头率${cleanText(multiline[1])}`;
}
function firstOfferId(links) {
    for (const link of links) {
        const offerId = extractOfferId(link);
        if (offerId)
            return offerId;
    }
    return null;
}
function firstContactUrl(links) {
    for (const link of links) {
        const url = buildContactUrl(link);
        if (url)
            return url;
    }
    return null;
}
async function readStorePayload(page, url, action) {
    const state = await gotoAndReadState(page, url, 2500, action);
    assertAuthenticatedState(state, action);
    return await page.evaluate(`
    (() => ({
      href: window.location.href,
      title: document.title || '',
      bodyText: document.body ? document.body.innerText || '' : '',
      offerLinks: Array.from(document.querySelectorAll('a[href*="detail.1688.com/offer/"], a[href*="offerId="]'))
        .map((anchor) => anchor.href)
        .filter(Boolean),
      contactLinks: Array.from(document.querySelectorAll('a[href*="contactinfo"]'))
        .map((anchor) => anchor.href)
        .filter(Boolean),
    }))()
  `);
}
async function readItemSeed(page, offerId) {
    const itemUrl = buildDetailUrl(offerId);
    const state = await gotoAndReadState(page, itemUrl, 2500, 'store seed item');
    assertAuthenticatedState(state, 'store seed item');
    const seed = await page.evaluate(`
    (() => {
      const model = window.context?.result?.global?.globalData?.model ?? null;
      const toJson = (value) => JSON.parse(JSON.stringify(value ?? null));
      return {
        href: window.location.href,
        bodyText: document.body ? document.body.innerText || '' : '',
        seller: toJson(model?.sellerModel),
        services: toJson(model?.shippingServices?.fields?.buyerProtectionModel ?? []),
      };
    })()
  `);
    const hasSellerContext = !!cleanText(seed?.seller?.memberId) || !!cleanText(seed?.seller?.winportUrl);
    if (!hasSellerContext) {
        throw new CommandExecutionError('1688 store seed item did not expose seller context', '当前 tab 非商品详情上下文，请切到 detail.1688.com 商品页并重试');
    }
    return seed;
}
function hasAnyEvidence(storePayload, contactPayload, seed) {
    return !!cleanText(storePayload?.bodyText)
        || !!cleanText(contactPayload?.bodyText)
        || !!cleanText(seed?.bodyText);
}
cli({
    site: '1688',
    name: 'store',
    access: 'read',
    description: '1688 店铺/供应商公开信息（联系方式、主营、入驻年限、公开服务信号）',
    domain: 'www.1688.com',
    strategy: Strategy.COOKIE,
    navigateBefore: false,
    args: [
        {
            name: 'input',
            required: true,
            positional: true,
            help: '1688 店铺 URL 或 member ID（如 b2b-22154705262941f196）',
        },
    ],
    columns: ['store_name', 'years_on_platform_text', 'location', 'return_rate_text'],
    func: async (page, kwargs) => {
        const rawInput = String(kwargs.input ?? '');
        const resolvedUrl = resolveStoreUrl(rawInput);
        const explicitMemberId = extractMemberId(rawInput);
        const storePayload = await readStorePayload(page, resolvedUrl, 'store');
        const contactUrl = firstContactUrl(storePayload.contactLinks ?? []) || buildContactUrl(storePayload.href || resolvedUrl);
        const contactPayload = contactUrl ? await readStorePayload(page, contactUrl, 'store contact') : null;
        const offerId = extractOfferId(rawInput)
            || firstOfferId(storePayload.offerLinks ?? [])
            || firstOfferId(contactPayload?.offerLinks ?? []);
        let seed = null;
        if (offerId) {
            try {
                seed = await readItemSeed(page, offerId);
            }
            catch (error) {
                if (!(error instanceof CommandExecutionError))
                    throw error;
            }
        }
        if (!hasAnyEvidence(storePayload, contactPayload, seed)) {
            throw new EmptyResultError('1688 store', 'Store page is reachable but no visible fields were extracted. Open the store page in Chrome and retry.');
        }
        return [
            normalizeStorePayload({
                resolvedUrl,
                storePayload,
                contactPayload,
                seed,
                explicitMemberId,
            }),
        ];
    },
});
export const __test__ = {
    normalizeStorePayload,
    safeCanonicalStoreUrl,
    buildContactUrl,
    firstNamedLine,
    firstMetric,
    extractReturnRate,
    firstOfferId,
    firstContactUrl,
};
