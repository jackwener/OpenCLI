import {
    createPriceNode,
    createPricingSnapshot,
    parseYuanAmount,
    parseYuanRange,
} from '../_shared/pricing.js';

export function classifyTaobaoPriceLabel(context = '') {
    const text = String(context).replace(/\s+/g, ' ').trim();
    const hasListingLabel = /优惠前/.test(text);
    const hasEstimateLabel = /平台加补后|到手价|应付|实付|合计/.test(text);
    if (hasListingLabel && hasEstimateLabel) return 'mixed';
    if (hasListingLabel) return 'listing';
    if (/券后|券已抵/.test(text)) return 'coupon';
    if (/活动价|秒杀价|限时价|直降/.test(text)) return 'activity';
    if (/补贴|以旧换新/.test(text)) return 'subsidy';
    if (hasEstimateLabel) return 'estimated';
    if (/月供|分期|定金|预付/.test(text)) return 'installment';
    if (/原价|划线价/.test(text)) return 'original';
    return 'listing';
}

export function extractTaobaoDiscountBreakdown(context = '') {
    const text = String(context).replace(/\s+/g, ' ').trim();
    const coupon = text.match(/满\s*[\d,]+\s*减\s*([\d,.]+)/);
    const subsidy = text.match(/(?:国家补贴|国补)\s*省\s*([\d,.]+)/)
        || text.match(/(?:国家补贴|国补)\s*([\d,]+(?:\.\d+)?)\s*元/);
    const coins = text.match(/淘金币已抵\s*([\d,.]+)/);
    return {
        coupon_amount: coupon ? parseYuanAmount(coupon[1]) : null,
        subsidy_amount: subsidy ? parseYuanAmount(subsidy[1]) : null,
        coin_discount_amount: coins ? parseYuanAmount(coins[1]) : null,
        exchange_eligibility: /以旧换新立减\s*[\d,.]+/.test(text)
            ? text.match(/以旧换新立减\s*[\d,.]+/)?.[0] || null
            : null,
    };
}

function toCandidate(row, index) {
    const text = String(row?.text || row?.context || '').replace(/\s+/g, ' ').trim();
    const context = String(row?.context || text).replace(/\s+/g, ' ').trim();
    const range = parseYuanRange(text) || parseYuanRange(context);
    if (!range) return null;
    const textHasPriceLabel = /优惠前|平台加补后|券后|活动价|原价|月供|分期/.test(text);
    const trustedPriceSelector = /priceText|priceInt|normalPrice|highlightPrice|subPrice|beltPrice/i.test(String(row?.selector || ''));
    let label = classifyTaobaoPriceLabel(textHasPriceLabel ? text : context);
    if (label === 'listing' && !textHasPriceLabel && !trustedPriceSelector) {
        label = 'unknown';
    }
    return {
        ...row,
        index,
        text,
        context,
        range,
        label,
    };
}

function listingRank(candidate) {
    let score = 0;
    if (/^优惠前/.test(candidate.text)) score += 100;
    if (/起/.test(candidate.text)) score += 20;
    if (/priceText|priceInt|subPrice|highlightPrice/i.test(String(candidate.selector || ''))) score += 10;
    score -= candidate.index;
    return score;
}

export function buildTaobaoPriceModelFromState(res = {}) {
    const componentPrice = res?.componentsVO?.priceVO || {};
    const price = componentPrice.price || {};
    const extraPrice = componentPrice.extraPrice || {};
    const itemId = String(res?.item?.itemId || '');
    const title = String(res?.item?.title || '');
    const listingAmount = parseYuanAmount(price.priceText);
    const estimatedAmount = parseYuanAmount(extraPrice.priceText);
    const listing = createPriceNode(listingAmount, {
        display: listingAmount == null ? null : `${price.priceTitle || '价格'} ${price.priceUnit || '¥'}${price.priceText || listingAmount}${price.priceDesc || ''}`,
        source_kind: 'page_state',
        source_path: 'loaderData.home.data.res.componentsVO.priceVO.price.priceText',
        evidence: `${price.priceTitle || ''} ${price.priceText || ''}`,
    });
    if (listing.amount != null) {
        listing.scope = price.priceDesc === '起' ? 'range_floor' : 'exact';
    }

    const estimated = createPriceNode(estimatedAmount, {
        display: estimatedAmount == null ? null : `${extraPrice.priceTitle || '预估'} ${extraPrice.priceUnit || '¥'}${extraPrice.priceText || estimatedAmount}${extraPrice.priceDesc || ''}`,
        source_kind: 'page_state',
        source_path: 'loaderData.home.data.res.componentsVO.priceVO.extraPrice.priceText',
        evidence: `${extraPrice.priceTitle || ''} ${extraPrice.priceText || ''}`,
        state: estimatedAmount == null ? 'not_computable' : 'observed',
    });

    const sku2info = res?.skuCore?.sku2info || {};
    const skuBase = res?.skuBase || {};
    const propNames = new Map(
        (skuBase.props || []).map(prop => [String(prop.pid), prop.name || '']),
    );
    const propValues = new Map();
    for (const prop of skuBase.props || []) {
        for (const [vid, value] of Object.entries(prop.valueMap || {})) {
            propValues.set(`${prop.pid}:${vid}`, value?.name || '');
        }
    }
    const skuNames = new Map(
        (skuBase.skus || []).map(sku => [
            String(sku.skuId),
            String(sku.propPath || '')
                .split(';')
                .filter(Boolean)
                .map(pair => propValues.get(pair) || propNames.get(pair.split(':')[0]) || pair)
                .filter(Boolean)
                .join(' / '),
        ]),
    );
    const skus = Object.entries(sku2info)
        .filter(([skuId]) => skuId !== '0')
        .map(([skuId, info]) => ({
            sku_id: skuId,
            name: skuNames.get(skuId) || '',
            listing_price: parseYuanAmount(info?.price?.priceText),
            estimated_payable: parseYuanAmount(info?.subPrice?.priceText),
            quantity: Number(info?.quantity ?? 0),
        }));

    return {
        itemId,
        title,
        skus,
        pricing: createPricingSnapshot({
            listing,
            estimated,
            checkout: createPriceNode(null, { state: 'not_attempted', source_kind: 'checkout' }),
            context: {
                price_basis: 'listing',
                requires_sku_selection: Array.isArray(res?.skuBase?.skus) ? res.skuBase.skus.length > 1 : false,
                sku_count: skus.length,
            },
        }),
    };
}

export function buildTaobaoPriceModel(rows = []) {
    const candidates = rows.map(toCandidate).filter(Boolean);
    const listingCandidates = candidates
        .filter(candidate => candidate.label === 'listing')
        .sort((a, b) => listingRank(b) - listingRank(a));
    const listingCandidate = listingCandidates[0] || null;
    const estimateCandidate = candidates.find(candidate => candidate.label === 'estimated') || null;
    const activityCandidate = candidates.find(candidate => candidate.label === 'activity') || null;
    const couponCandidate = candidates.find(candidate => candidate.label === 'coupon') || null;
    const originalCandidate = candidates.find(candidate => candidate.label === 'original') || null;
    const context = candidates.map(candidate => candidate.context).join(' ');
    const breakdown = extractTaobaoDiscountBreakdown(context);

    const listing = listingCandidate
        ? createPriceNode(listingCandidate.range.amount, {
            display: listingCandidate.text,
            source_kind: 'dom_detail',
            source_path: listingCandidate.selector || 'taobao:right-content-area',
            evidence: listingCandidate.context,
        })
        : createPriceNode(null, { state: 'not_present' });
    if (listing.amount != null) {
        listing.min = listingCandidate.range.min;
        listing.max = listingCandidate.range.max;
        listing.scope = listingCandidate.text.includes('起') ? 'range_floor' : 'exact';
    }

    const make = (candidate) => candidate
        ? createPriceNode(candidate.range.amount, {
            display: candidate.text,
            source_kind: 'dom_detail',
            source_path: candidate.selector || null,
            evidence: candidate.context,
        })
        : createPriceNode(null);

    const estimated = make(estimateCandidate);
    if (estimated.amount == null) estimated.state = 'not_computable';

    return createPricingSnapshot({
        listing,
        original: make(originalCandidate),
        activity: make(activityCandidate),
        coupon: make(couponCandidate),
        estimated,
        checkout: createPriceNode(null, { state: 'not_attempted', source_kind: 'checkout' }),
        context: {
            price_basis: 'listing',
            ...breakdown,
            requires_sku_selection: false,
        },
    });
}

export function normalizeTaobaoSearchPrice(price, context = '') {
    const amount = parseYuanAmount(price);
    const label = classifyTaobaoPriceLabel(context);
    const hasExplicitLabel = /优惠前|平台加补后|券后|券已抵|活动价|秒杀价|限时价|直降|到手价|应付|实付|合计|原价|划线价/.test(String(context));
    const basis = hasExplicitLabel && ['listing', 'activity', 'coupon', 'estimated'].includes(label)
        ? label
        : 'displayed_card';
    return {
        price_num: amount,
        listing_price: basis === 'listing' ? amount : null,
        activity_price: basis === 'activity' ? amount : null,
        coupon_price: basis === 'coupon' ? amount : null,
        estimated_payable: basis === 'estimated' ? amount : null,
        price_basis: basis,
        price_source: 'search_card_dom',
    };
}
