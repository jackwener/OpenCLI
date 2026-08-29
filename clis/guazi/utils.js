/**
 * Shared helpers for the 瓜子二手车 (Guazi) used-car adapter.
 *
 * The desktop www.guazi.com SPA renders an empty shell and loads listings
 * from a signature-locked API (`mapi.guazi.com`, rejects unsigned requests
 * with 签名验证失败). The MOBILE site `m.guazi.com`, however, server-side
 * renders the full listing list and car detail into the HTML with no login,
 * no signature, and no anti-bot challenge — so this adapter reads the mobile
 * SSR HTML with an iPhone UA.
 *
 * Limitation: deep pagination and brand/keyword filtering route through the
 * signed API, so `browse` returns the first SSR page (~40 fresh listings) for
 * a city. That is surfaced honestly rather than faked.
 */

import {
    ArgumentError,
    AuthRequiredError,
    CommandExecutionError,
    EmptyResultError,
} from '@jackwener/opencli/errors';

export const GUAZI_M_BASE = 'https://m.guazi.com';

const UA =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 '
    + '(KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1';

export const BROWSE_COLUMNS = ['rank', 'clue_id', 'title', 'price', 'down_payment', 'mileage', 'year', 'city', 'url'];
export const CAR_COLUMNS = ['field', 'value'];

/**
 * Common city → Guazi city code (the path segment in m.guazi.com/<code>/buy/).
 */
export const CITY_CODE = {
    beijing: 'bj', '北京': 'bj',
    shanghai: 'sh', '上海': 'sh',
    guangzhou: 'gz', '广州': 'gz',
    shenzhen: 'sz', '深圳': 'sz',
    hangzhou: 'hz', '杭州': 'hz',
    chengdu: 'cd', '成都': 'cd',
    chongqing: 'cq', '重庆': 'cq',
    nanjing: 'nj', '南京': 'nj',
    wuhan: 'wh', '武汉': 'wh',
    tianjin: 'tj', '天津': 'tj',
    xian: 'xa', '西安': 'xa',
    suzhou: 'su', '苏州': 'su',
    zhengzhou: 'zz', '郑州': 'zz',
    changsha: 'cs', '长沙': 'cs',
    qingdao: 'qd', '青岛': 'qd',
    shenyang: 'sy', '沈阳': 'sy',
    dalian: 'dl', '大连': 'dl',
    jinan: 'jn', '济南': 'jn',
    hefei: 'hf', '合肥': 'hf',
    foshan: 'fs', '佛山': 'fs',
};

/** Resolve a city arg (name or code) to a Guazi city code; defaults to bj. */
export function resolveCityCode(cityArg) {
    if (cityArg == null || cityArg === '') return 'bj';
    const raw = String(cityArg).trim().toLowerCase();
    if (CITY_CODE[raw]) return CITY_CODE[raw];
    if (CITY_CODE[String(cityArg).trim()]) return CITY_CODE[String(cityArg).trim()];
    if (/^[a-z]{2,3}$/.test(raw)) return raw; // already a code
    const names = Object.keys(CITY_CODE).filter((k) => /^[a-z]+$/.test(k)).join(', ');
    throw new ArgumentError('city', `unknown city '${cityArg}'. pass a Guazi city code or one of: ${names}`);
}

/**
 * 中文品牌名 → Guazi brand slug (the `/<city>/<slug>/` path segment).
 * Captured live from the guazi brand filter rail. Guazi uses an idiosyncratic
 * mix of English, pinyin, and abbreviations, so this is a fixed lookup rather
 * than anything derivable.
 */
export const BRAND_SLUG = {
    '奔驰': 'benz', '宝马': 'bmw', '奥迪': 'audi', '大众': 'dazhong',
    '丰田': 'toyota', '本田': 'honda', '日产': 'richan', '别克': 'buick',
    '福特': 'ford', '雪佛兰': 'chevrolet', '马自达': 'mazda', '雷克萨斯': 'lexus',
    '保时捷': 'porsche', '路虎': 'landrover', '沃尔沃': 'volvo', '凯迪拉克': 'cadillac',
    '克莱斯勒': 'chrysler', '名爵': 'mg1', '红旗': 'hongqi', '比亚迪': 'byd',
    '特斯拉': 'tesila', '小鹏': 'xpqc', '蔚来': 'weilai', '理想': 'lixiang',
    '理想汽车': 'lixiang', '小米': 'xiaomiqiche', '小米汽车': 'xiaomiqiche',
    '零跑': 'lpqc', '零跑汽车': 'lpqc', '腾势': 'tengshi', '坦克': 'tk',
    '领克': 'lk', '岚图': 'lt-qc', '岚图汽车': 'lt-qc', '五菱': 'wuling',
    '五菱汽车': 'wuling', '启辰': 'qichen', '鸿蒙智行': 'aito', '问界': 'aito',
};

/**
 * Resolve a brand arg (中文 name or an already-known slug) to a Guazi brand
 * slug. Returns null for an empty arg.
 */
export function resolveBrandSlug(brandArg) {
    if (brandArg == null || brandArg === '') return null;
    const raw = String(brandArg).trim();
    if (BRAND_SLUG[raw]) return BRAND_SLUG[raw];
    const noSuffix = raw.replace(/(汽车|二手车)$/, '');
    if (BRAND_SLUG[noSuffix]) return BRAND_SLUG[noSuffix];
    const lower = raw.toLowerCase();
    if (/^[a-z0-9-]{2,20}$/.test(lower)) return lower; // already a slug
    const names = Object.keys(BRAND_SLUG).filter((k) => !/汽车$/.test(k)).slice(0, 24).join('、');
    throw new ArgumentError('brand', `unknown brand '${brandArg}'. pass a Guazi brand slug or one of: ${names} …`);
}

/** Normalize a clue id: a bare number or a /car-detail/c<id>.htm(l) URL. */
export function normalizeClueId(rawInput) {
    const raw = String(rawInput || '').trim();
    if (!raw) throw new ArgumentError('clue_id must be a non-empty value');
    const m = raw.match(/car-detail\/c(\d+)/) || raw.match(/^c?(\d+)$/);
    if (!m) {
        throw new ArgumentError(`'${rawInput}' does not look like a guazi clue id (a number, or a /car-detail/c<id>.html URL)`);
    }
    return m[1];
}

export function requireLimit(value, def, max) {
    const raw = value == null || value === '' ? def : value;
    const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
    if (!Number.isInteger(n) || n < 1 || n > max) {
        throw new ArgumentError(`limit must be an integer between 1 and ${max}`);
    }
    return n;
}

export function clean(s) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
}

export function requireText(value, label) {
    const text = clean(value);
    if (!text) throw new CommandExecutionError(`${label} did not include a stable text value.`);
    return text;
}

export function requireStableId(value, label) {
    const id = String(value ?? '').trim();
    if (!/^\d+$/.test(id)) throw new CommandExecutionError(`${label} did not include a stable numeric id.`);
    return id;
}

/** Fetch a Guazi mobile page as HTML text, throwing typed errors. */
export async function guaziFetch(path, contextHint) {
    let resp;
    try {
        resp = await fetch(`${GUAZI_M_BASE}${path}`, {
            headers: {
                'User-Agent': UA,
                Referer: `${GUAZI_M_BASE}/`,
                'Accept-Language': 'zh-CN,zh;q=0.9',
            },
        });
    } catch (err) {
        throw new CommandExecutionError(`guazi ${contextHint} network error: ${err?.message || err}`);
    }
    if (!resp.ok) {
        throw new CommandExecutionError(`guazi ${contextHint} HTTP ${resp.status}`);
    }
    const html = await resp.text();
    // Guazi may eventually push the mobile pages behind their JS challenge.
    if (/瑞数|reese84|captcha|滑动验证|verify\.guazi|安全验证/i.test(html) && !/car-detail\/c\d+/.test(html)) {
        throw new AuthRequiredError(
            'guazi.com',
            `guazi ${contextHint} hit an anti-bot challenge — Guazi may have started gating the mobile site.`,
        );
    }
    return html;
}

export { ArgumentError, CommandExecutionError, EmptyResultError };
