import { CommandExecutionError } from '../../errors.js';
import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import { isRecord } from '../../utils.js';
import {
  assertAuthenticatedState,
  buildDetailUrl,
  buildProvenance,
  canonicalizeSellerUrl,
  cleanMultilineText,
  cleanText,
  extractLocation,
  extractMemberId,
  extractOfferId,
  extractShopId,
  gotoAndReadState,
  normalizePriceTiers,
  parseMoqText,
  parsePriceText,
  toNumber,
  uniqueNonEmpty,
} from './shared.js';

interface BuyerProtectionModel {
  serviceName?: string;
  shortBuyerDesc?: string;
  packageBuyerDesc?: string;
  textDesc?: string;
  agreeDeliveryHours?: number;
}

interface ItemBrowserPayload {
  href?: string;
  title?: string;
  bodyText?: string;
  offerTitle?: string;
  offerId?: string | number;
  seller?: {
    companyName?: string;
    memberId?: string;
    winportUrl?: string;
    sellerWinportUrlMap?: Record<string, string>;
  };
  trade?: {
    beginAmount?: string | number;
    priceDisplay?: string;
    unit?: string;
    saleCount?: string | number;
    offerIDatacenterSellInfo?: Record<string, unknown>;
    offerPriceModel?: {
      currentPrices?: Array<{ beginAmount?: string | number; price?: string | number }>;
    };
  };
  gallery?: {
    mainImage?: string[];
    offerImgList?: string[];
    wlImageInfos?: Array<{ fullPathImageURI?: string }>;
  };
  shipping?: {
    deliveryLimitText?: string;
    logisticsText?: string;
    protectionInfos?: BuyerProtectionModel[];
    buyerProtectionModel?: BuyerProtectionModel[];
  };
  services?: BuyerProtectionModel[];
}

interface VisibleAttribute {
  key: string;
  value: string;
}

function normalizeItemPayload(payload: ItemBrowserPayload): Record<string, unknown> {
  const href = cleanText(payload.href);
  const bodyText = cleanMultilineText(payload.bodyText);
  const sellerName = cleanText(payload.seller?.companyName);
  const sellerUrlRaw = cleanText(
    payload.seller?.winportUrl
      ?? payload.seller?.sellerWinportUrlMap?.defaultUrl
      ?? payload.seller?.sellerWinportUrlMap?.indexUrl,
  );
  const sellerUrl = canonicalizeSellerUrl(sellerUrlRaw);
  const offerId = cleanText(String(payload.offerId ?? '')) || extractOfferId(href) || null;
  const memberId = cleanText(payload.seller?.memberId) || extractMemberId(sellerUrlRaw || href) || null;
  const shopId = extractShopId(sellerUrl ?? href);
  const unit = cleanText(payload.trade?.unit);
  const priceDisplay = cleanText(payload.trade?.priceDisplay);
  const priceRange = parsePriceText(priceDisplay ? `¥${priceDisplay}` : bodyText);
  const moqText = extractMoqText(bodyText, payload.trade?.beginAmount, unit);
  const moq = parseMoqText(moqText);
  const services = uniqueServices(payload);
  const serviceBadges = uniqueNonEmpty(services.map((service) => cleanText(service.serviceName)));
  const attributes = normalizeVisibleAttributes(payload.trade?.offerIDatacenterSellInfo);
  const priceTiers = normalizePriceTiers(payload.trade?.offerPriceModel?.currentPrices ?? [], unit || null);
  const images = uniqueNonEmpty([
    ...(payload.gallery?.mainImage ?? []),
    ...(payload.gallery?.offerImgList ?? []),
    ...((payload.gallery?.wlImageInfos ?? []).map((item) => item.fullPathImageURI ?? '')),
  ]);

  const detailUrl = offerId ? buildDetailUrl(offerId) : href;
  const provenance = buildProvenance(href || detailUrl);

  return {
    offer_id: offerId,
    member_id: memberId,
    shop_id: shopId,
    title: cleanText(payload.offerTitle) || stripAlibabaSuffix(payload.title) || firstNonEmptyLine(bodyText) || null,
    item_url: detailUrl,
    main_images: images,
    price_text: priceRange.price_text || null,
    price_tiers: priceTiers,
    currency: priceRange.currency,
    moq_text: moq.moq_text || null,
    moq_value: moq.moq_value,
    seller_name: sellerName || null,
    seller_url: sellerUrl,
    shop_name: sellerName || null,
    origin_place: extractLocation(bodyText),
    delivery_days_text: extractDeliveryDaysText(bodyText, services, payload.shipping),
    customization_text: extractKeywordLine(bodyText, ['来样定制', '来图定制', '支持定制', '可定制', '定制']),
    private_label_text: extractKeywordLine(bodyText, ['贴牌', '贴标', '定制logo', '打logo', 'OEM', 'ODM']),
    visible_attributes: attributes,
    sales_text: extractSalesText(bodyText),
    service_badges: serviceBadges,
    stock_quantity: extractStockQuantity(bodyText),
    ...provenance,
  };
}

function normalizeVisibleAttributes(raw: unknown): VisibleAttribute[] {
  if (!isRecord(raw)) return [];
  return Object.entries(raw)
    .filter(([key, value]) => key !== 'sellPointModel' && cleanText(key) && cleanText(String(value)))
    .map(([key, value]) => ({ key: cleanText(key), value: cleanText(String(value)) }));
}

function uniqueServices(payload: ItemBrowserPayload): BuyerProtectionModel[] {
  const combined = [
    ...(Array.isArray(payload.services) ? payload.services : []),
    ...(Array.isArray(payload.shipping?.protectionInfos) ? payload.shipping.protectionInfos : []),
    ...(Array.isArray(payload.shipping?.buyerProtectionModel) ? payload.shipping.buyerProtectionModel : []),
  ];

  const seen = new Set<string>();
  const result: BuyerProtectionModel[] = [];
  for (const service of combined) {
    const key = cleanText(service.serviceName);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(service);
  }
  return result;
}

function stripAlibabaSuffix(title: string | undefined): string {
  return cleanText(title).replace(/\s*-\s*阿里巴巴$/, '').trim();
}

function firstNonEmptyLine(text: string): string {
  return text.split('\n').map((line) => cleanText(line)).find(Boolean) ?? '';
}

function extractMoqText(bodyText: string, beginAmount: string | number | undefined, unit: string): string {
  const lineMatch = bodyText.match(/\d+(?:\.\d+)?\s*(件|个|套|箱|包|双|台|把|只)\s*起批/);
  if (lineMatch) return lineMatch[0];

  const moqValue = toNumber(beginAmount);
  if (moqValue !== null) {
    return `${moqValue}${unit || ''}起批`;
  }

  return '';
}

function extractDeliveryDaysText(
  bodyText: string,
  services: BuyerProtectionModel[],
  shipping: ItemBrowserPayload['shipping'],
): string | null {
  const shippingText = cleanText(shipping?.deliveryLimitText) || cleanText(shipping?.logisticsText);
  if (shippingText) return shippingText;

  const textMatch = bodyText.match(/\d+\s*(?:小时|天)(?:内)?发货/);
  if (textMatch) return textMatch[0];

  const hourMatch = services.find((service) => typeof service.agreeDeliveryHours === 'number');
  if (hourMatch && typeof hourMatch.agreeDeliveryHours === 'number') {
    return `${hourMatch.agreeDeliveryHours}小时内发货`;
  }

  return null;
}

function extractKeywordLine(bodyText: string, keywords: string[]): string | null {
  const lines = bodyText.split('\n').map((line) => cleanText(line)).filter(Boolean);
  for (const line of lines) {
    if (keywords.some((keyword) => line.includes(keyword))) {
      return line;
    }
  }
  return null;
}

function extractSalesText(bodyText: string): string | null {
  const match = bodyText.match(/(?:全网销量|已售)\s*\d+(?:\.\d+)?\+?\s*[件套个单]?/);
  return match ? cleanText(match[0]) : null;
}

function extractStockQuantity(bodyText: string): number | null {
  const match = bodyText.match(/库存\s*(\d+)/);
  return match ? Number.parseInt(match[1], 10) : null;
}

async function readItemPayload(page: IPage, itemUrl: string): Promise<ItemBrowserPayload> {
  const state = await gotoAndReadState(page, itemUrl, 2500, 'item');
  assertAuthenticatedState(state, 'item');

  const payload = await page.evaluate(`
    (() => {
      const root = window.context ?? {};
      const model = root.result?.global?.globalData?.model ?? null;
      const toJson = (value) => JSON.parse(JSON.stringify(value ?? null));
      return {
        href: window.location.href,
        title: document.title || '',
        bodyText: document.body ? document.body.innerText || '' : '',
        offerTitle: model?.offerTitleModel?.subject ?? '',
        offerId: model?.tradeModel?.offerId ?? '',
        seller: toJson(model?.sellerModel),
        trade: toJson(model?.tradeModel),
        gallery: toJson(root.result?.data?.gallery?.fields ?? null),
        shipping: toJson(root.result?.data?.shippingServices?.fields ?? null),
        services: toJson(root.result?.data?.shippingServices?.fields?.protectionInfos ?? []),
      };
    })()
  `) as ItemBrowserPayload;

  const resolvedOfferId = cleanText(String(payload.offerId ?? '')) || extractOfferId(cleanText(payload.href));
  if (!resolvedOfferId) {
    throw new CommandExecutionError(
      '1688 item page did not expose product context',
      '当前 tab 非商品详情上下文，请切到 detail.1688.com 商品页并重试',
    );
  }

  return payload;
}

cli({
  site: '1688',
  name: 'item',
  description: '1688 商品详情（公开商品字段、价格阶梯、卖家基础信息）',
  domain: 'www.1688.com',
  strategy: Strategy.COOKIE,
  navigateBefore: false,
  args: [
    {
      name: 'input',
      required: true,
      positional: true,
      help: '1688 商品 URL 或 offer ID（如 887904326744）',
    },
  ],
  columns: ['offer_id', 'title', 'price_text', 'moq_text', 'seller_name', 'origin_place'],
  func: async (page, kwargs) => {
    const itemUrl = buildDetailUrl(String(kwargs.input ?? ''));
    const payload = await readItemPayload(page, itemUrl);
    return [normalizeItemPayload(payload)];
  },
});

export const __test__ = {
  normalizeItemPayload,
  normalizeVisibleAttributes,
  stripAlibabaSuffix,
  extractMoqText,
  extractDeliveryDaysText,
  extractKeywordLine,
  extractSalesText,
  extractStockQuantity,
};
