import { CommandExecutionError } from '../../errors.js';
import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import {
  FACTORY_BADGE_PATTERNS,
  SERVICE_BADGE_PATTERNS,
  assertNotCaptcha,
  buildCaptchaHint,
  buildDetailUrl,
  buildProvenance,
  cleanMultilineText,
  cleanText,
  extractAddress,
  extractBadges,
  extractMainBusiness,
  extractMemberId,
  extractMetric,
  extractOfferId,
  extractShopId,
  extractYearsOnPlatform,
  gotoAndReadState,
  guessTopCategories,
  resolveStoreUrl,
  uniqueNonEmpty,
} from './shared.js';

interface StoreBrowserPayload {
  href?: string;
  title?: string;
  bodyText?: string;
  offerLinks?: string[];
  contactLinks?: string[];
}

interface StoreItemSeed {
  href?: string;
  bodyText?: string;
  seller?: {
    companyName?: string;
    memberId?: string;
    winportUrl?: string;
    sellerWinportUrlMap?: Record<string, string>;
  };
  services?: Array<{ serviceName?: string }>;
}

function collectOfferIds(
  rawInput: string,
  storePayload: StoreBrowserPayload | null,
  contactPayload: StoreBrowserPayload | null,
): string[] {
  const ids = uniqueNonEmpty([
    rawInput,
    ...(storePayload?.offerLinks ?? []),
    ...(contactPayload?.offerLinks ?? []),
  ])
    .map((value) => extractOfferId(value))
    .filter((value): value is string => Boolean(value));

  return [...new Set(ids)];
}

function normalizeStorePayload(input: {
  resolvedUrl: string;
  storePayload: StoreBrowserPayload | null;
  contactPayload: StoreBrowserPayload | null;
  seed: StoreItemSeed | null;
  explicitMemberId: string | null;
}): Record<string, unknown> {
  const storePayload = input.storePayload;
  const contactPayload = input.contactPayload;
  const seed = input.seed;

  const contactText = cleanMultilineText(contactPayload?.bodyText);
  const storeText = cleanMultilineText(storePayload?.bodyText);
  const seedText = cleanMultilineText(seed?.bodyText);
  const combinedText = [contactText, storeText, seedText].filter(Boolean).join('\n');

  const sellerUrl = cleanText(
    seed?.seller?.winportUrl
      ?? seed?.seller?.sellerWinportUrlMap?.defaultUrl
      ?? storePayload?.href
      ?? input.resolvedUrl,
  );
  const memberId = cleanText(seed?.seller?.memberId)
    || input.explicitMemberId
    || extractMemberId(input.resolvedUrl)
    || null;
  const shopId = extractShopId(sellerUrl) ?? extractShopId(input.resolvedUrl);
  const companyName = cleanText(seed?.seller?.companyName)
    || firstNamedLine(contactText)
    || firstNamedLine(storeText)
    || null;
  const storeUrl = canonicalStoreUrl(sellerUrl || input.resolvedUrl);
  const companyUrl = buildContactUrl(storeUrl) ?? storeUrl;
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
    ...buildProvenance(contactPayload?.href || storePayload?.href || input.resolvedUrl),
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
  };
}

function canonicalStoreUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.hostname}`;
  } catch {
    return url;
  }
}

function buildContactUrl(storeUrl: string): string | null {
  try {
    const parsed = new URL(storeUrl);
    return `${parsed.protocol}//${parsed.hostname}/page/contactinfo.html`;
  } catch {
    return null;
  }
}

function firstNamedLine(text: string): string | null {
  return text
    .split('\n')
    .map((line) => cleanText(line))
    .find((line) => line.includes('有限公司') || line.includes('商行') || line.includes('工厂'))
    ?? null;
}

function firstMetric(text: string, labels: string[]): string | null {
  for (const label of labels) {
    const value = extractMetric(text, label);
    if (value) return value;
  }
  return null;
}

function extractReturnRate(text: string): string | null {
  const inline = text.match(/回头率\s*([0-9.]+%)/);
  if (inline) return inline[1];
  const multiline = text.match(/回头率\n([0-9.]+%)/);
  return multiline ? multiline[1] : null;
}

function firstOfferId(links: string[]): string | null {
  for (const link of links) {
    const offerId = extractOfferId(link);
    if (offerId) return offerId;
  }
  return null;
}

async function readStorePayload(
  page: IPage,
  url: string,
  action: string,
): Promise<StoreBrowserPayload> {
  const state = await gotoAndReadState(page, url, 2500, action);
  assertNotCaptcha(state, action);

  return await page.evaluate(`
    (() => ({
      href: window.location.href,
      title: document.title || '',
      bodyText: document.body ? document.body.innerText || '' : '',
      offerLinks: Array.from(document.querySelectorAll('a[href*="detail.1688.com/offer/"]'))
        .map((anchor) => anchor.href)
        .filter(Boolean),
      contactLinks: Array.from(document.querySelectorAll('a[href*="contactinfo"]'))
        .map((anchor) => anchor.href)
        .filter(Boolean),
    }))()
  `) as StoreBrowserPayload;
}

async function readItemSeed(
  page: IPage,
  offerId: string,
): Promise<StoreItemSeed> {
  const itemUrl = buildDetailUrl(offerId);
  const state = await gotoAndReadState(page, itemUrl, 2500, 'store seed item');
  assertNotCaptcha(state, 'store seed item');

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
  `) as StoreItemSeed;

  if (!cleanText(seed.href) || !seed.seller) {
    throw new CommandExecutionError(
      '1688 store seed item did not expose seller context',
      `${buildCaptchaHint('item')} Open a real 1688 item page in Chrome and retry.`,
    );
  }

  return seed;
}

async function readFirstUsableItemSeed(
  page: IPage,
  offerIds: string[],
): Promise<StoreItemSeed | null> {
  for (const offerId of offerIds.slice(0, 8)) {
    try {
      return await readItemSeed(page, offerId);
    } catch (err) {
      if (!(err instanceof CommandExecutionError)) throw err;
    }
  }
  return null;
}

cli({
  site: '1688',
  name: 'store',
  description: '1688 店铺/供应商公开信息（联系方式、主营、入驻年限、公开服务信号）',
  domain: 'www.1688.com',
  strategy: Strategy.COOKIE,
  navigateBefore: false,
  args: [
    {
      name: 'input',
      required: true,
      positional: true,
      help: '1688 店铺 URL、店铺 host 或 member ID（如 b2b-22154705262941f196）',
    },
  ],
  columns: ['company_name', 'years_on_platform_text', 'location', 'return_rate_text'],
  func: async (page, kwargs) => {
    const rawInput = String(kwargs.input ?? '');
    const resolvedUrl = resolveStoreUrl(rawInput);
    const explicitMemberId = extractMemberId(rawInput);

    const storePayload = await readStorePayload(page, resolvedUrl, 'store');
    const contactUrl = buildContactUrl(storePayload.href || resolvedUrl);
    const contactPayload = contactUrl ? await readStorePayload(page, contactUrl, 'store contact') : null;
    const seed = await readFirstUsableItemSeed(
      page,
      collectOfferIds(rawInput, storePayload, contactPayload),
    );

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
  canonicalStoreUrl,
  buildContactUrl,
  firstNamedLine,
  firstMetric,
  extractReturnRate,
  firstOfferId,
  collectOfferIds,
};
