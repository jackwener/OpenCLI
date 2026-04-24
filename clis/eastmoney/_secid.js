// Shared helpers for resolving eastmoney "secid" (市场.代码).
//
// Markets:
//   1.XXXXXX → Shanghai A (SSE)
//   0.XXXXXX → Shenzhen A (SZSE) or Beijing (BSE) — eastmoney groups both under 0
//   116.XXXXX → Hong Kong
//   105.SYMBOL → NASDAQ
//   106.SYMBOL → NYSE
//   107.SYMBOL → AMEX (US)

const A_PREFIX_TO_MARKET = /** @param {string} c */ (c) => {
  if (/^(60|68|90|113|900)/.test(c)) return '1';          // SH (A + STAR + old B)
  if (/^(00|30|20)/.test(c)) return '0';                  // SZ (A + ChiNext + B)
  if (/^(4|8|920|83|87)/.test(c)) return '0';             // BJ (eastmoney uses 0.)
  return '0';
};

/**
 * Resolve various user inputs to an eastmoney `secid`.
 *  - "600000"         → "1.600000"
 *  - "sh600000"       → "1.600000"
 *  - "sz000001"       → "0.000001"
 *  - "bj430047"       → "0.430047"
 *  - "hk00700" / "00700.HK" → "116.00700"
 *  - "us.AAPL" / "AAPL" → "105.AAPL"
 *  - "1.600000"       → passed through
 * @param {string} input
 * @returns {string}
 */
// Known eastmoney market numeric prefixes. Narrow whitelist so that inputs like
// "00700.HK" are NOT mistakenly treated as secids just because they look like
// "<digits>.<alphanumeric>".
const KNOWN_MARKET_PREFIXES = new Set(['0', '1', '100', '105', '106', '107', '116', '140', '150', '151', '152', '155', '156']);

export function resolveSecid(input) {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('empty symbol');
  const secidMatch = raw.match(/^(\d{1,3})\.([A-Za-z0-9]+)$/);
  if (secidMatch && KNOWN_MARKET_PREFIXES.has(secidMatch[1])) return raw; // already a secid
  const lower = raw.toLowerCase();

  // market-prefixed Chinese code
  const pref = lower.match(/^(sh|sz|bj)(\d{6})$/);
  if (pref) {
    const [, mk, code] = pref;
    return (mk === 'sh' ? '1' : '0') + '.' + code;
  }

  // hk prefix
  const hk = lower.match(/^hk(\d{4,5})$/) || lower.match(/^(\d{4,5})\.hk$/);
  if (hk) return '116.' + hk[1].padStart(5, '0');

  // us.SYMBOL or SYMBOL.N/.O  (treat all as NASDAQ by default; .N as NYSE)
  const usDot = lower.match(/^([a-z.\-]+)\.([no])$/);
  if (usDot) return (usDot[2] === 'n' ? '106' : '105') + '.' + usDot[1].toUpperCase();
  const usPref = lower.match(/^us\.([a-z.\-]+)$/);
  if (usPref) return '105.' + usPref[1].toUpperCase();

  // bare 6-digit Chinese code
  if (/^\d{6}$/.test(raw)) return A_PREFIX_TO_MARKET(raw) + '.' + raw;

  // bare US ticker — uppercase letters only
  if (/^[A-Z.\-]{1,8}$/.test(raw)) return '105.' + raw;

  throw new Error(`Unrecognized symbol: ${input}`);
}

/**
 * Normalize a list of user inputs separated by comma / space / Chinese comma.
 * @param {string} s
 * @returns {string[]}
 */
export function splitSymbols(s) {
  return String(s || '')
    .split(/[,，\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}
