/**
 * Shared price normalization for price-sensitive adapters.
 *
 * Amounts are yuan. Unknown prices stay null; 0 and '-' are never valid
 * successful prices.
 */

const UNIT_MULTIPLIERS = {
    万: 10_000,
    亿: 100_000_000,
};

function roundMoney(value) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
}

function parseMagnitude(digits, unit) {
    const number = Number(digits);
    if (!Number.isFinite(number)) return null;
    const amount = roundMoney(number * (UNIT_MULTIPLIERS[unit] || 1));
    return amount > 0 ? amount : null;
}

export function parseYuanAmount(value) {
    if (typeof value === 'number') {
        return Number.isFinite(value) && value > 0 ? roundMoney(value) : null;
    }
    if (value == null) return null;

    const raw = String(value).replace(/,/g, '').trim();
    if (!raw) return null;

    const match = raw.match(/(\d+(?:\.\d+)?)\s*([万亿])?/);
    if (!match) return null;
    return parseMagnitude(match[1], match[2]);
}

export function parseYuanRange(value) {
    if (typeof value === 'number') {
        const amount = parseYuanAmount(value);
        return amount == null ? null : { amount, min: amount, max: amount };
    }
    if (value == null) return null;

    const raw = String(value).replace(/,/g, '').trim();
    if (!raw) return null;

    const range = raw.match(
        /(?:[¥￥]\s*)?(\d+(?:\.\d+)?)\s*([万亿])?\s*(?:-|~|～|—|至)\s*(?:[¥￥]\s*)?(\d+(?:\.\d+)?)\s*([万亿])?/,
    );
    if (range) {
        const min = parseMagnitude(range[1], range[2]);
        const max = parseMagnitude(range[3], range[4]);
        if (min != null && max != null) {
            return {
                amount: Math.min(min, max),
                min: Math.min(min, max),
                max: Math.max(min, max),
            };
        }
    }

    const amount = parseYuanAmount(raw);
    return amount == null ? null : { amount, min: amount, max: amount };
}

export function formatYuan(amount) {
    if (!Number.isFinite(amount) || amount <= 0) return null;
    return `¥${Number.isInteger(amount) ? String(amount) : amount.toFixed(2)}`;
}

export function formatYuanRange(min, max) {
    const formattedMin = formatYuan(min);
    const formattedMax = formatYuan(max);
    if (!formattedMin) return null;
    if (!formattedMax || max === min) return formattedMin;
    return `${formattedMin} - ${formattedMax}`;
}

export function createPriceNode(amount, options = {}) {
    const parsed = parseYuanAmount(amount);
    return {
        amount: parsed,
        display: options.display ?? formatYuan(parsed),
        state: parsed == null ? (options.state || 'not_present') : (options.state || 'observed'),
        source_kind: options.source_kind || 'none',
        source_path: options.source_path || null,
        evidence: options.evidence == null ? null : String(options.evidence).slice(0, 240),
    };
}

export function priceNodeFromRange(value, options = {}) {
    const range = parseYuanRange(value);
    if (!range) return createPriceNode(null, options);
    return {
        amount: range.amount,
        min: range.min,
        max: range.max,
        display: options.display ?? formatYuanRange(range.min, range.max),
        state: options.state || 'observed',
        source_kind: options.source_kind || 'none',
        source_path: options.source_path || null,
        evidence: options.evidence == null ? null : String(options.evidence).slice(0, 240),
    };
}

export function createPricingSnapshot(parts = {}) {
    const missing = (state = 'not_present') => createPriceNode(null, { state });
    return {
        schema_version: 1,
        currency: 'CNY',
        primary: parts.primary || 'listing',
        listing: parts.listing || missing(),
        original: parts.original || missing(),
        activity: parts.activity || missing(),
        coupon: parts.coupon || missing(),
        estimated: parts.estimated || missing('not_computable'),
        checkout: parts.checkout || missing('not_attempted'),
        context: parts.context || {},
    };
}
