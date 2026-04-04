import { CommandExecutionError } from '../../errors.js';
import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import {
  buildProductUrl,
  buildProvenance,
  cleanText,
  extractAsin,
  isAmazonEntity,
  normalizeProductUrl,
  PRIMARY_PRICE_SELECTORS,
  parsePriceText,
  assertUsableState,
  gotoAndReadState,
} from './shared.js';

interface OfferPayload {
  href?: string;
  title?: string;
  price_text?: string | null;
  merchant_info?: string | null;
  sold_by?: string | null;
  ships_from_text?: string | null;
  offer_link?: string | null;
  review_url?: string | null;
  qa_url?: string | null;
  buybox_text?: string | null;
}

const OFFER_FACT_SELECTOR = [
  '#sellerProfileTriggerId',
  '#shipsFromSoldByInsideBuyBox_feature_div',
  '#fulfillerInfoFeature_feature_div',
  '#merchantInfoFeature_feature_div',
  '#tabular-buybox-container',
  '#merchant-info',
].join(', ');

function collapseAdjacentWords(text: string): string {
  const parts = cleanText(text).split(' ').filter(Boolean);
  const deduped: string[] = [];
  for (const part of parts) {
    if (deduped[deduped.length - 1] === part) continue;
    deduped.push(part);
  }
  return deduped.join(' ');
}

function extractShipsFrom(text: string): string | null {
  const normalized = cleanText(text);
  const match = normalized.match(/Ships from\s+(.+?)(?=Sold by|and Fulfilled by|$)/i);
  return match ? collapseAdjacentWords(match[1].replace(/Ships from/ig, '')) : null;
}

function extractSoldBy(text: string): string | null {
  const normalized = cleanText(text);
  const match = normalized.match(/Sold by\s+(.+?)(?=and Fulfilled by|Ships from|$)/i);
  return match ? collapseAdjacentWords(match[1]) : null;
}

function isDeliveryLocationBlocked(text: string | null | undefined): boolean {
  const normalized = cleanText(text).toLowerCase();
  return normalized.includes('cannot be shipped to your selected delivery location')
    || normalized.includes('similar items shipping to')
    || normalized.includes('deliver to hong kong');
}

function normalizeOfferPayload(payload: OfferPayload): Record<string, unknown> {
  const asin = extractAsin(payload.href ?? '') ?? null;
  const sourceUrl = cleanText(payload.href) || buildProductUrl(payload.href ?? '');
  const price = parsePriceText(payload.price_text);
  const merchantInfo = cleanText(payload.merchant_info) || null;
  const soldBy = cleanText(payload.sold_by)
    || extractSoldBy(payload.ships_from_text ?? '')
    || extractSoldBy(merchantInfo ?? '')
    || null;
  const shipsFrom = extractShipsFrom(payload.ships_from_text ?? '')
    || extractShipsFrom(merchantInfo ?? '')
    || cleanText(payload.ships_from_text)
    || null;
  const provenance = buildProvenance(sourceUrl);

  return {
    asin,
    product_url: normalizeProductUrl(payload.href),
    ...provenance,
    price_text: price.price_text,
    price_value: price.price_value,
    currency: price.currency,
    merchant_info_text: merchantInfo,
    sold_by: soldBy,
    ships_from: shipsFrom,
    offer_listing_url: cleanText(payload.offer_link) || null,
    review_url: cleanText(payload.review_url) || null,
    qa_url: cleanText(payload.qa_url) || null,
    is_amazon_sold: isAmazonEntity(soldBy),
    is_amazon_fulfilled: isAmazonEntity(shipsFrom) || /fulfilled by amazon/i.test(merchantInfo ?? ''),
  };
}

async function readOfferPayload(page: IPage, input: string): Promise<OfferPayload> {
  const url = buildProductUrl(input);
  const state = await gotoAndReadState(page, url, 2500, 'offer');
  assertUsableState(state, 'offer');

  // Reconnecting to an existing Amazon target can surface the product page
  // before the buy-box / merchant blocks are reattached to the DOM.
  await page.wait({ selector: OFFER_FACT_SELECTOR, timeout: 6 }).catch(() => {});

  return await page.evaluate(`
    (() => ({
      href: window.location.href,
      title: document.title || '',
      price_text: (() => {
        const selectors = ${JSON.stringify(PRIMARY_PRICE_SELECTORS)};
        for (const selector of selectors) {
          const text = document.querySelector(selector)?.textContent || '';
          if (text.trim()) return text;
        }
        return '';
      })(),
      merchant_info: document.querySelector('#merchant-info')?.textContent || '',
      sold_by: document.querySelector('#sellerProfileTriggerId')?.textContent || '',
      ships_from_text:
        document.querySelector('#shipsFromSoldByInsideBuyBox_feature_div')?.textContent
        || document.querySelector('#fulfillerInfoFeature_feature_div')?.textContent
        || document.querySelector('#merchantInfoFeature_feature_div')?.textContent
        || document.querySelector('#tabular-buybox-container')?.textContent
        || '',
      offer_link: document.querySelector('a[href*="/gp/offer-listing/"]')?.href || '',
      review_url: document.querySelector('a[href*="#customerReviews"]')?.href || '',
      qa_url: document.querySelector('a[href*="ask/questions"]')?.href || '',
      buybox_text:
        document.querySelector('#desktop_qualifiedBuyBox')?.textContent
        || document.querySelector('#buybox')?.textContent
        || '',
    }))()
  `) as OfferPayload;
}

cli({
  site: 'amazon',
  name: 'offer',
  description: 'Amazon seller, buy box, and fulfillment facts from the product page',
  domain: 'amazon.com',
  strategy: Strategy.COOKIE,
  navigateBefore: false,
  args: [
    {
      name: 'input',
      required: true,
      positional: true,
      help: 'ASIN or product URL, for example B0FJS72893',
    },
  ],
  columns: ['asin', 'price_text', 'sold_by', 'ships_from', 'is_amazon_sold', 'is_amazon_fulfilled'],
  func: async (page, kwargs) => {
    const input = String(kwargs.input ?? '');
    const payload = await readOfferPayload(page, input);
    const normalized = normalizeOfferPayload(payload);

    if (!normalized.sold_by && !normalized.ships_from && !normalized.merchant_info_text) {
      if (isDeliveryLocationBlocked(payload.buybox_text)) {
        throw new CommandExecutionError(
          'amazon offer buy box is blocked by the current delivery location',
          'The shared Chrome profile is not set to the target US delivery address. Switch Amazon delivery location to the requested US destination, reopen the product page, and retry.',
        );
      }

      throw new CommandExecutionError(
        'amazon offer surface did not expose seller or fulfillment facts',
        'The product page may have changed. Open the product page in Chrome, make sure the buy box is visible, and retry.',
      );
    }

    return [normalized];
  },
});

export const __test__ = {
  extractShipsFrom,
  extractSoldBy,
  isDeliveryLocationBlocked,
  normalizeOfferPayload,
};
