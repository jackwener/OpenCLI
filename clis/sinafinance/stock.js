/**
 * Sinafinance stock quote — A股 / 港股 / 美股
 *
 * Uses two public Sina APIs (no browser required):
 *   suggest3.sinajs.cn  — symbol search
 *   hq.sinajs.cn        — real-time quote
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';
const MARKET_CN = '11';
const MARKET_HK = '31';
const MARKET_US = '41';
async function fetchGBK(url) {
    const res = await fetch(url, { headers: { Referer: 'https://finance.sina.com.cn' } });
    if (!res.ok)
        throw new CliError('FETCH_ERROR', `Sina API HTTP ${res.status}`, 'Check your network');
    const buf = await res.arrayBuffer();
    return new TextDecoder('gbk').decode(buf);
}
function parseSuggest(raw, markets) {
    const m = raw.match(/suggestvalue="(.*)"/s);
    if (!m)
        return [];
    return m[1].split(';').filter(Boolean).map(s => {
        const p = s.split(',');
        return { name: p[4] || p[0] || '', market: p[1] || '', symbol: p[3] || '' };
    }).filter(e => markets.includes(e.market));
}
function hqSymbol(e) {
    if (e.market === MARKET_HK)
        return `hk${e.symbol}`;
    if (e.market === MARKET_US)
        return `gb_${e.symbol}`;
    return e.symbol; // A股: already "sh600519" / "sz300XXX"
}
function parseHq(raw, sym) {
    const escaped = sym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = raw.match(new RegExp(`hq_str_${escaped}="([^"]*)"`));
    return m ? m[1].split(',') : [];
}
function fmtMktCap(val) {
    const n = parseFloat(val);
    if (!n)
        return '';
    if (n >= 1e12)
        return (n / 1e12).toFixed(2) + 'T';
    if (n >= 1e9)
        return (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6)
        return (n / 1e6).toFixed(2) + 'M';
    return String(n);
}
cli({
    site: 'sinafinance',
    name: 'stock',
    access: 'read',
    description: '新浪财经行情（A股/港股/美股）',
    domain: 'suggest3.sinajs.cn,hq.sinajs.cn',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'key', type: 'string', required: true, positional: true, help: 'Stock name or code (e.g. 贵州茅台, 腾讯控股, AAPL)' },
        { name: 'market', type: 'string', default: 'auto', help: 'Market: cn, hk, us, auto (default: auto searches cn → hk → us)' },
    ],
    columns: ['Symbol', 'Name', 'Price', 'Change', 'ChangePercent', 'Open', 'High', 'Low', 'Volume', 'MarketCap'],
    func: async (args) => {
        const key = String(args.key);
        const market = String(args.market);
        const marketMap = {
            cn: [MARKET_CN], hk: [MARKET_HK], us: [MARKET_US],
            auto: [MARKET_CN, MARKET_HK, MARKET_US],
        };
        const targetMarkets = marketMap[market];
        if (!targetMarkets) {
            throw new CliError('INPUT_ERROR', `Invalid market: "${market}"`, 'Expected cn, hk, us, or auto');
        }
        // 1. Search symbol — only request the markets we care about
        const suggestRaw = await fetchGBK(`https://suggest3.sinajs.cn/suggest/type=${targetMarkets.join(',')}&key=${encodeURIComponent(key)}`);
        const entries = parseSuggest(suggestRaw, targetMarkets);
        if (!entries.length) {
            throw new CliError('NOT_FOUND', `No stock found for "${key}"`, 'Try a different name, code, or --market');
        }
        // Pick best match: score by name/symbol similarity, tiebreak by market priority
        const needle = key.toLowerCase();
        const score = (e) => {
            const n = e.name.toLowerCase();
            const s = e.symbol.toLowerCase();
            if (s === needle || n === needle)
                return 1;
            if (s.includes(needle))
                return needle.length / s.length;
            if (n.includes(needle))
                return needle.length / n.length;
            return 0;
        };
        const best = entries.sort((a, b) => {
            const d = score(b) - score(a);
            return d !== 0 ? d : targetMarkets.indexOf(a.market) - targetMarkets.indexOf(b.market);
        })[0];
        // 2. Fetch quote
        const sym = hqSymbol(best);
        const hqRaw = await fetchGBK(`https://hq.sinajs.cn/list=${sym}`);
        const f = parseHq(hqRaw, sym);
        if (f.length < 2 || !f[0]) {
            throw new CliError('NOT_FOUND', `No quote data for "${key}"`, 'Market may be closed or data unavailable');
        }
        if (best.market === MARKET_CN) {
            const price = parseFloat(f[3]);
            const prev = parseFloat(f[2]);
            const chg = (price - prev).toFixed(2);
            const chgPct = ((price - prev) / prev * 100).toFixed(2) + '%';
            return [{ Symbol: sym.toUpperCase(), Name: f[0], Price: f[3], Change: chg, ChangePercent: chgPct, Open: f[1], High: f[4], Low: f[5], Volume: f[8], MarketCap: '' }];
        }
        if (best.market === MARKET_HK) {
            // [2]=price [4]=high [5]=low [6]=open [7]=change [8]=change% [11]=volume
            return [{ Symbol: best.symbol, Name: f[1], Price: f[2], Change: f[7], ChangePercent: f[8] + '%', Open: f[6], High: f[4], Low: f[5], Volume: f[11], MarketCap: '' }];
        }
        // MARKET_US: [1]=price [2]=change% [4]=change [6]=open [7]=today_low [8]=52wH [9]=52wL [10]=volume [12]=mktcap
        return [{ Symbol: best.symbol.toUpperCase(), Name: f[0], Price: f[1], Change: f[4], ChangePercent: f[2] + '%', Open: f[6], High: f[8], Low: f[9], Volume: f[10], MarketCap: fmtMktCap(f[12]) }];
    },
});
