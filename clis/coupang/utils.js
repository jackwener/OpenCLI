function itemKey(item) {
    return item.url || item.product_id || `${item.title}:${item.price ?? ''}`;
}
const ROCKET_PATTERNS = ['판매자로켓', '로켓프레시', '로켓와우', '로켓배송', '로켓직구'];
const DELIVERY_TYPE_PATTERNS = ['무료배송', '일반배송'];
const DELIVERY_PROMISE_PATTERNS = ['오늘도착', '내일도착', '새벽도착', '오늘출발'];
const BADGE_ID_TO_ROCKET = {
    ROCKET: '로켓배송',
    ROCKET_MERCHANT: '판매자로켓',
    ROCKET_WOW: '로켓와우',
    WOW: '로켓와우',
    ROCKET_FRESH: '로켓프레시',
    FRESH: '로켓프레시',
    SELLER_ROCKET: '판매자로켓',
    ROCKET_JIKGU: '로켓직구',
    JIKGU: '로켓직구',
    COUPANG_GLOBAL: '로켓직구',
};
const BADGE_ID_TO_PROMISE = {
    DAWN: '새벽도착',
    EARLY_DAWN: '새벽도착',
    TOMORROW: '내일도착',
    TODAY: '오늘도착',
    SAME_DAY: '오늘도착',
    TODAY_SHIP: '오늘출발',
    TODAY_DISPATCH: '오늘출발',
};
function asString(value) {
    if (value == null)
        return '';
    return String(value).trim();
}
function toNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value))
        return value;
    const text = asString(value).replace(/[^\d.]/g, '');
    if (!text)
        return null;
    const num = Number(text);
    return Number.isFinite(num) ? num : null;
}
function pickFirst(obj, paths) {
    for (const path of paths) {
        const parts = path.split('.');
        let current = obj;
        let ok = true;
        for (const part of parts) {
            if (!current || typeof current !== 'object' || !(part in current)) {
                ok = false;
                break;
            }
            current = current[part];
        }
        if (ok && current != null && asString(current) !== '')
            return current;
    }
    return null;
}
export function normalizeProductId(raw) {
    const text = asString(raw);
    if (!text)
        return '';
    const match = text.match(/\/vp\/products\/(\d+)/) || text.match(/\b(\d{6,})\b/);
    return match?.[1] ?? text;
}
export function canonicalizeProductUrl(rawUrl, productId) {
    const raw = asString(rawUrl);
    if (raw) {
        try {
            const url = new URL(raw.startsWith('http') ? raw : `https://www.coupang.com${raw}`);
            if (!url.hostname.includes('coupang.com'))
                return '';
            const id = normalizeProductId(url.pathname) || normalizeProductId(productId);
            if (!id)
                return url.toString();
            return `https://www.coupang.com/vp/products/${id}`;
        }
        catch {
            return '';
        }
    }
    const id = normalizeProductId(productId);
    return id ? `https://www.coupang.com/vp/products/${id}` : '';
}
function extractTokens(values) {
    return values
        .flatMap((value) => {
        const text = asString(value);
        if (!text)
            return [];
        return text.split(/[,\s|]+/);
    })
        .map((token) => token.trim().toUpperCase())
        .filter(Boolean);
}
function normalizeJoinedText(...values) {
    return values
        .map(asString)
        .filter(Boolean)
        .join(' ')
        .replace(/schema\.org\/[A-Za-z]+/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
function normalizeRocket(...values) {
    const tokens = extractTokens(values);
    for (const token of tokens) {
        if (BADGE_ID_TO_ROCKET[token])
            return BADGE_ID_TO_ROCKET[token];
    }
    const text = normalizeJoinedText(...values);
    if (!text)
        return '';
    if (/판매자\s*로켓/.test(text))
        return '판매자로켓';
    if (/로켓\s*프레시|새벽\s*도착\s*보장/.test(text))
        return '로켓프레시';
    if (/로켓\s*와우/.test(text))
        return '로켓와우';
    if (/로켓\s*직구|직구/.test(text))
        return '로켓직구';
    if (/로켓\s*배송/.test(text))
        return '로켓배송';
    return ROCKET_PATTERNS.find(pattern => text.includes(pattern)) ?? '';
}
function normalizeDeliveryType(...values) {
    const text = normalizeJoinedText(...values);
    if (!text)
        return '';
    if (/무료\s*배송/.test(text))
        return '무료배송';
    if (/일반\s*배송/.test(text))
        return '일반배송';
    return DELIVERY_TYPE_PATTERNS.find(pattern => text.includes(pattern)) ?? '';
}
function normalizeDeliveryPromise(...values) {
    const tokens = extractTokens(values);
    for (const token of tokens) {
        if (BADGE_ID_TO_PROMISE[token])
            return BADGE_ID_TO_PROMISE[token];
    }
    const text = normalizeJoinedText(...values);
    if (!text)
        return '';
    if (/오늘\s*출발/.test(text))
        return '오늘출발';
    if (/오늘.*도착/.test(text))
        return '오늘도착';
    if (/새벽.*도착/.test(text))
        return '새벽도착';
    if (/내일.*도착/.test(text))
        return '내일도착';
    return DELIVERY_PROMISE_PATTERNS.find(pattern => text.includes(pattern)) ?? '';
}
function normalizeBadge(value) {
    const normalizeOne = (entry) => {
        const text = asString(entry);
        if (!text)
            return '';
        if (/schema\.org\//i.test(text)) {
            return text.split('/').pop() ?? '';
        }
        return text;
    };
    if (Array.isArray(value)) {
        return value.map(normalizeOne).filter(Boolean).join(', ');
    }
    return normalizeOne(value);
}
export function normalizeSearchItem(raw, index) {
    const productId = normalizeProductId(pickFirst(raw, ['productId', 'product_id', 'id', 'productNo', 'item.id', 'product.productId', 'url']));
    const title = asString(pickFirst(raw, ['title', 'name', 'productName', 'productTitle', 'itemName', 'item.title']));
    const price = toNumber(pickFirst(raw, ['price', 'salePrice', 'finalPrice', 'sellingPrice', 'discountPrice', 'item.price']));
    const originalPrice = toNumber(pickFirst(raw, ['originalPrice', 'basePrice', 'listPrice', 'originPrice', 'strikePrice']));
    const unitPrice = asString(pickFirst(raw, ['unitPrice', 'unit_price', 'unitPriceText']));
    const rating = toNumber(pickFirst(raw, ['rating', 'star', 'reviewRating', 'review.rating', 'item.rating']));
    const reviewCount = toNumber(pickFirst(raw, ['reviewCount', 'ratingCount', 'reviews', 'reviewCnt', 'item.reviewCount']));
    const deliveryHintValues = [
        pickFirst(raw, ['deliveryType', 'deliveryBadge', 'badgeLabel', 'shippingType', 'shippingBadge']),
        pickFirst(raw, ['badge', 'badges', 'labels', 'benefitBadge', 'promotionBadge']),
        pickFirst(raw, ['text', 'summary']),
        pickFirst(raw, ['deliveryPromise', 'promise', 'arrivalText', 'arrivalBadge']),
        pickFirst(raw, ['rocket', 'rocketType']),
    ];
    const deliveryType = normalizeDeliveryType(...deliveryHintValues);
    const deliveryPromise = normalizeDeliveryPromise(...deliveryHintValues);
    const rocket = normalizeRocket(...deliveryHintValues);
    const badge = normalizeBadge(pickFirst(raw, ['badge', 'badges', 'labels', 'benefitBadge', 'promotionBadge']));
    const category = asString(pickFirst(raw, ['category', 'categoryName', 'categoryPath', 'item.category']));
    const seller = asString(pickFirst(raw, ['seller', 'sellerName', 'vendorName', 'merchantName', 'item.seller']));
    const url = canonicalizeProductUrl(pickFirst(raw, ['url', 'productUrl', 'link', 'item.url']), productId);
    const discountRate = toNumber(pickFirst(raw, ['discountRate', 'discount', 'discountPercent', 'discount_rate']));
    return {
        rank: index + 1,
        product_id: productId,
        title,
        price,
        original_price: originalPrice,
        unit_price: unitPrice,
        discount_rate: discountRate,
        rating,
        review_count: reviewCount,
        rocket,
        delivery_type: deliveryType,
        delivery_promise: deliveryPromise,
        seller,
        badge,
        category,
        url,
    };
}
export function dedupeSearchItems(items) {
    const seen = new Set();
    const out = [];
    for (const item of items) {
        const key = itemKey(item);
        if (!key || seen.has(key))
            continue;
        seen.add(key);
        out.push({ ...item, rank: out.length + 1 });
    }
    return out;
}
export function sanitizeSearchItems(items, limit) {
    return dedupeSearchItems(items.filter(item => Boolean(item.title && (item.product_id || item.url)))).slice(0, limit);
}
export function mergeSearchItems(base, extra, limit) {
    const extraMap = new Map();
    for (const item of extra) {
        const key = itemKey(item);
        if (key)
            extraMap.set(key, item);
    }
    const merged = base.map((item) => {
        const key = itemKey(item);
        const patch = key ? extraMap.get(key) : null;
        if (!patch)
            return item;
        return {
            ...item,
            price: patch.price ?? item.price,
            original_price: patch.original_price ?? item.original_price,
            unit_price: patch.unit_price || item.unit_price,
            discount_rate: patch.discount_rate ?? item.discount_rate,
            rating: patch.rating ?? item.rating,
            review_count: patch.review_count ?? item.review_count,
            rocket: patch.rocket || item.rocket,
            delivery_type: patch.delivery_type || item.delivery_type,
            delivery_promise: patch.delivery_promise || item.delivery_promise,
            seller: patch.seller || item.seller,
            badge: patch.badge || item.badge,
            category: patch.category || item.category,
            url: patch.url || item.url,
        };
    });
    const mergedKeys = new Set(merged.map(item => itemKey(item)).filter(Boolean));
    const appended = extra.filter(item => {
        const key = itemKey(item);
        return key && !mergedKeys.has(key);
    });
    return sanitizeSearchItems([...merged, ...appended], limit);
}
