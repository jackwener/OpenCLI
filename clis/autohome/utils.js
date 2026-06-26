/**
 * Shared helpers for the 汽车之家 (Autohome) adapter.
 *
 * Autohome's keyword-search and per-trim-config JSON APIs are app-signature
 * gated (and the config page additionally uses CSS font-glyph obfuscation),
 * so those are deliberately NOT used — they cannot be read reliably without a
 * browser running Autohome's signing code, and faking partial data would be
 * worse than omitting it. Two sources ARE clean, no-login, plain-HTTP:
 *
 *   1. The brand catalog `grade/carhtml/<INITIAL>.html` — every series of a
 *      brand with its 指导价 (guide price), keyed by the brand's pinyin
 *      initial letter (hence the BRAND_INITIAL map below).
 *   2. The 口碑 page `k.autohome.com.cn/<seriesId>` — a Next.js page whose
 *      `__NEXT_DATA__.props.pageProps.baseData` carries the aggregate owner
 *      rating (overall + per-dimension), level, price, competitors, and the
 *      reliability PPH (每百辆车故障数).
 *
 * So the adapter searches by BRAND (you almost always know the brand) and
 * reads ratings by seriesId — both unsigned, both login-free.
 */

import {
    ArgumentError,
    CommandExecutionError,
    EmptyResultError,
} from '@jackwener/opencli/errors';

export const AH_BASE = 'https://www.autohome.com.cn';
export const AH_KOUBEI_BASE = 'https://k.autohome.com.cn';

const UA =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
    + '(KHTML, like Gecko) Chrome/126.0 Safari/537.36';

export const BRAND_COLUMNS = ['series_id', 'name', 'price', 'url'];
export const SCORE_COLUMNS = ['field', 'value'];

/**
 * 中文品牌名 → 车系目录页的拼音首字母 (grade/carhtml/<X>.html).
 * Covers the brands people actually search; unknown brands raise a clear
 * error rather than guessing the wrong page.
 */
export const BRAND_INITIAL = {
    奥迪: 'A', 阿斯顿马丁: 'A', 阿尔法罗密欧: 'A', 阿维塔: 'A', 埃安: 'A', 极狐: 'A',
    宝马: 'B', 奔驰: 'B', 比亚迪: 'B', 别克: 'B', 本田: 'B', 标致: 'B', 保时捷: 'B', 宝骏: 'B', 北京: 'B', 北汽: 'B', 宾利: 'B', 北京现代: 'B',
    长安: 'C', 长城: 'C', 长安启源: 'C', 长安欧尚: 'C', 传祺: 'C',
    大众: 'D', 东风: 'D', 道奇: 'D', 东风风行: 'D', 东风小康: 'D',
    法拉利: 'F', 福特: 'F', 丰田: 'F', 菲亚特: 'F', 福田: 'F', 方程豹: 'F', 飞凡: 'F',
    广汽: 'G', 广汽丰田: 'G', 广汽本田: 'G', 高合: 'G',
    哈弗: 'H', 红旗: 'H', 海马: 'H', 悍马: 'H', 哈飞: 'H', 华晨: 'H',
    吉利: 'J', 捷豹: 'J', 极氪: 'J', 江淮: 'J', 几何: 'J', 捷途: 'J', 金杯: 'J', 江铃: 'J', 吉普: 'J', 极石: 'J',
    凯迪拉克: 'K', 克莱斯勒: 'K', 开瑞: 'K', 凯翼: 'K',
    兰博基尼: 'L', 路虎: 'L', 雷克萨斯: 'L', 林肯: 'L', 铃木: 'L', 劳斯莱斯: 'L', 雷诺: 'L', 理想: 'L', 领克: 'L', 零跑: 'L', 路特斯: 'L', 岚图: 'L', 猎豹: 'L',
    马自达: 'M', 迈巴赫: 'M', 名爵: 'M', 玛莎拉蒂: 'M', 迈凯伦: 'M',
    哪吒: 'N',
    欧拉: 'O',
    奇瑞: 'Q', 起亚: 'Q',
    日产: 'R', 荣威: 'R',
    斯巴鲁: 'S', 斯柯达: 'S', 三菱: 'S', 上汽大通: 'S', 思皓: 'S', 赛力斯: 'S', smart: 'S',
    特斯拉: 'T', 腾势: 'T', 坦克: 'T',
    沃尔沃: 'W', 五菱: 'W', 蔚来: 'W', 威马: 'W', 魏牌: 'W', 问界: 'W',
    现代: 'X', 雪佛兰: 'X', 雪铁龙: 'X', 小鹏: 'X', 星途: 'X', 小米: 'X',
    英菲尼迪: 'Y', 一汽: 'Y', 野马: 'Y', 仰望: 'Y',
    智己: 'Z', 中华: 'Z', 众泰: 'Z',
};

/** Resolve a brand name to its catalog initial letter. */
export function resolveBrandInitial(brandArg) {
    const raw = String(brandArg || '').trim();
    if (!raw) throw new ArgumentError('brand must be a non-empty value');
    // single A-Z letter passes through (advanced: fetch a whole letter page)
    if (/^[A-Za-z]$/.test(raw)) return raw.toUpperCase();
    const key = raw.replace(/[·\s]/g, '');
    if (BRAND_INITIAL[key]) return BRAND_INITIAL[key];
    if (BRAND_INITIAL[raw]) return BRAND_INITIAL[raw];
    throw new ArgumentError(
        'brand',
        `unknown brand '${brandArg}'. Pass a known Chinese brand name (e.g. 宝马 / 比亚迪 / 理想) or a single A-Z catalog letter.`,
    );
}

/** Normalize a series id: a bare number or an autohome URL containing it. */
export function normalizeSeriesId(rawInput) {
    const raw = String(rawInput || '').trim();
    if (!raw) throw new ArgumentError('series_id must be a non-empty value');
    const m = raw.match(/\/(?:s)?(\d+)(?:\/|$|\.)/) || raw.match(/^s?(\d+)$/);
    if (!m) {
        throw new ArgumentError(`'${rawInput}' does not look like an autohome series id (a number, or a k.autohome.com.cn/<id> URL)`);
    }
    return m[1];
}

export function clean(s) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
}

export function requireLimit(value, def, max) {
    const raw = value == null || value === '' ? def : value;
    const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
    if (!Number.isInteger(n) || n < 1 || n > max) {
        throw new ArgumentError(`limit must be an integer between 1 and ${max}`);
    }
    return n;
}

export function requireStableId(value, label) {
    const id = String(value ?? '').trim();
    if (!/^\d+$/.test(id)) throw new CommandExecutionError(`${label} did not include a stable numeric id.`);
    return id;
}

export function requireText(value, label) {
    const text = clean(value);
    if (!text) throw new CommandExecutionError(`${label} did not include a stable text value.`);
    return text;
}

export function assertPlainObject(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new CommandExecutionError(`${label} returned an unexpected payload shape; expected an object.`);
    }
    return value;
}

/** Fetch an Autohome page as text. The grade + koubei pages are UTF-8. */
export async function ahFetch(url, contextHint) {
    let resp;
    try {
        resp = await fetch(url, {
            headers: {
                'User-Agent': UA,
                Referer: `${AH_BASE}/`,
                'Accept-Language': 'zh-CN,zh;q=0.9',
            },
        });
    } catch (err) {
        throw new CommandExecutionError(`autohome ${contextHint} network error: ${err?.message || err}`);
    }
    if (!resp.ok) {
        throw new CommandExecutionError(`autohome ${contextHint} HTTP ${resp.status}`);
    }
    return resp.text();
}

/** Extract __NEXT_DATA__ pageProps from a koubei page (pure, testable). */
export function extractPageProps(html) {
    const m = String(html || '').match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) return null;
    try {
        const data = JSON.parse(m[1]);
        return (data && data.props && data.props.pageProps) || null;
    } catch {
        return null;
    }
}

export { ArgumentError, CommandExecutionError, EmptyResultError };
