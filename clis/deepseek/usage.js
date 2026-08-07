// DeepSeek platform usage summary.
// Reads data from the https://platform.deepseek.com/usage page.
// Uses the internal API for account summary + innerText extraction for time-dimension cards.

import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';

const DS_DOMAIN = 'platform.deepseek.com';
const USAGE_URL = 'https://platform.deepseek.com/usage';

// This code runs in the browser via page.evaluate.
// Backslash sequences are doubled because they are inside a JS template literal.
const EVAL_JS = `
    var BASE = 'https://platform.deepseek.com';

    // --- Auth: read token from localStorage ---
    let token = '';
    var raw = localStorage.getItem('userToken');
    if (raw) { try { var parsed = JSON.parse(raw); token = parsed.value || ''; } catch(e) { token = raw; } }

    async function fetchJson(url) {
        var headers = { Accept: 'application/json' };
        if (token) headers['Authorization'] = 'Bearer ' + token;
        var r = await fetch(url, { headers: headers });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        var d = await r.json();
        if (d.code !== 0) throw new Error('API code=' + d.code);
        var biz = d.data;
        if (biz && biz.biz_code !== 0) throw new Error('API biz_code=' + biz.biz_code);
        return biz && biz.biz_data;
    }

    // --- API: user summary ---
    async function fetchApiData() {
        var summary = await fetchJson(BASE + '/api/v0/users/get_user_summary');
        if (!summary || typeof summary !== 'object' || Array.isArray(summary)) {
            throw new Error('MALFORMED summary');
        }
        if (!Array.isArray(summary.normal_wallets)) throw new Error('MALFORMED normal_wallets');
        if (!Array.isArray(summary.bonus_wallets)) throw new Error('MALFORMED bonus_wallets');
        if (!Array.isArray(summary.total_costs)) throw new Error('MALFORMED total_costs');
        if (!Array.isArray(summary.monthly_costs)) throw new Error('MALFORMED monthly_costs');
        if (summary.monthly_token_usage === undefined) throw new Error('MALFORMED monthly_token_usage');
        if (summary.total_usage === undefined) throw new Error('MALFORMED total_usage');
        if (summary.total_available_token_estimation === undefined) {
            throw new Error('MALFORMED total_available_token_estimation');
        }

        function amount(value, label) {
            var n = Number(value);
            if (!Number.isFinite(n)) throw new Error('MALFORMED ' + label);
            return n.toFixed(2);
        }

        function integerish(value, label) {
            var s = String(value);
            if (!/^\\d+(?:\\.\\d+)?$/.test(s)) throw new Error('MALFORMED ' + label);
            return s;
        }

        var normalW = summary.normal_wallets.find(function(w) { return w && w.currency === 'CNY'; });
        var bonusW = summary.bonus_wallets.find(function(w) { return w && w.currency === 'CNY'; });
        return {
            balance: normalW ? amount(normalW.balance, 'balance') : '0.00',
            bonusBalance: bonusW ? amount(bonusW.balance, 'bonusBalance') : '0.00',
            cumulativeSpend: (summary.total_costs || []).length > 0
                ? amount(summary.total_costs[0].amount, 'cumulativeSpend') : '0.00',
            monthlySpend: (summary.monthly_costs || []).length > 0
                ? amount(summary.monthly_costs[0].amount, 'monthlySpend') : '0.00',
            monthlyTokens: integerish(summary.monthly_token_usage, 'monthlyTokens'),
            monthlyApiCalls: integerish(summary.total_usage, 'monthlyApiCalls'),
            currentTokenEstimation: integerish(summary.total_available_token_estimation, 'currentTokenEstimation'),
        };
    }

    // --- DOM: extract period card data from innerText ---
    function extractDomData() {
        var text = document.body.innerText;
        var lines = text.split('\\n');
        var result = {};

        // Find time period label (e.g. "近 7 天", "本月")
        for (var i = 0; i < lines.length; i++) {
            var m = lines[i].match(/近\\s*\\d+\\s*[天月]/);
            if (m) { result.timePeriod = m[0]; break; }
        }

        // Find period spend / API calls / Tokens
        // These appear after "导出" and before "消费金额（CNY）"
        var foundCount = 0;
        for (var i = 0; i < lines.length && foundCount < 3; i++) {
            var line = lines[i].trim();

            if (line === '消费金额') {
                // Skip if preceded by "累计消费" or "充值余额"
                var prevBlock = (i > 0 ? lines[i-1] : '') + (i > 1 ? lines[i-2] : '') + (i > 2 ? lines[i-3] : '');
                if (prevBlock.includes('累计消费') || prevBlock.includes('充值余额')) continue;
                // Look for ¥ value in next lines
                for (var j = i + 1; j < Math.min(i + 4, lines.length); j++) {
                    var val = lines[j].trim();
                    var vm = val.match(/^[¥￥]\\s*([\\d,.]+)/);
                    if (vm) {
                        result.periodSpend = vm[1].replace(/,/g, '');
                        foundCount++;
                        break;
                    }
                }
            } else if (line === 'API 请求次数') {
                for (var j = i + 1; j < Math.min(i + 4, lines.length); j++) {
                    var val = lines[j].trim();
                    if (/^[\\d,]+$/.test(val)) {
                        result.periodApiCalls = val.replace(/,/g, '');
                        foundCount++;
                        break;
                    }
                }
            } else if (line === 'Tokens') {
                for (var j = i + 1; j < Math.min(i + 4, lines.length); j++) {
                    var val = lines[j].trim();
                    if (/^[\\d,]+$/.test(val)) {
                        result.periodTokens = val.replace(/,/g, '');
                        foundCount++;
                        break;
                    }
                }
            }
        }

        return result;
    }

    var domData = extractDomData();

    // Call API and merge
    return fetchApiData().then(function(apiData) {
        return {
            balance: apiData.balance,
            bonusBalance: apiData.bonusBalance,
            cumulativeSpend: apiData.cumulativeSpend,
            monthlySpend: apiData.monthlySpend,
            monthlyApiCalls: apiData.monthlyApiCalls,
            monthlyTokens: apiData.monthlyTokens,
            currentTokenEstimation: apiData.currentTokenEstimation,
            timePeriod: domData.timePeriod,
            periodSpend: domData.periodSpend,
            periodApiCalls: domData.periodApiCalls,
            periodTokens: domData.periodTokens,
        };
    });
`;

function errorMessage(error) {
    return error && typeof error.message === 'string' ? error.message : String(error || '');
}

function requirePlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new CommandExecutionError('deepseek usage returned malformed payload: expected object');
    }
    return value;
}

function requireText(value, name) {
    const text = String(value ?? '').trim();
    if (!text) {
        throw new CommandExecutionError(`deepseek usage returned malformed payload: missing "${name}"`);
    }
    return text;
}

function requireNumericText(value, name, { decimal = false } = {}) {
    const text = requireText(value, name);
    if (!/^\d+(?:\.\d+)?$/.test(text)) {
        throw new CommandExecutionError(`deepseek usage returned malformed payload: invalid "${name}"`);
    }
    return decimal ? Number(text).toFixed(2) : text;
}

cli({
    site: 'deepseek',
    name: 'usage',
    access: 'read',
    description: 'Read DeepSeek platform usage: balance, cumulative spending, time-dimension spending, API requests, and Tokens.',
    domain: DS_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: true,
    args: [],
    columns: [
        'balance',
        'bonusBalance',
        'cumulativeSpend',
        'monthlySpend',
        'monthlyApiCalls',
        'monthlyTokens',
        'currentTokenEstimation',
        'timePeriod',
        'periodSpend',
        'periodApiCalls',
        'periodTokens',
    ],
    func: async (page) => {
        await page.goto(USAGE_URL);
        await page.wait(3);

        let data;
        try {
            data = await page.evaluate(`(() => {${EVAL_JS}})()`);
        } catch (error) {
            const message = errorMessage(error);
            if (/\bHTTP\s+(401|403)\b/i.test(message) || /unauth|login|token/i.test(message)) {
                throw new AuthRequiredError(DS_DOMAIN, 'DeepSeek platform usage requires a logged-in platform session');
            }
            throw new CommandExecutionError(`deepseek usage failed: ${message || 'unknown error'}`);
        }

        requirePlainObject(data);

        return [{
            balance: requireNumericText(data.balance, 'balance', { decimal: true }),
            bonusBalance: requireNumericText(data.bonusBalance, 'bonusBalance', { decimal: true }),
            cumulativeSpend: requireNumericText(data.cumulativeSpend, 'cumulativeSpend', { decimal: true }),
            monthlySpend: requireNumericText(data.monthlySpend, 'monthlySpend', { decimal: true }),
            monthlyApiCalls: requireNumericText(data.monthlyApiCalls, 'monthlyApiCalls'),
            monthlyTokens: requireNumericText(data.monthlyTokens, 'monthlyTokens'),
            currentTokenEstimation: requireNumericText(data.currentTokenEstimation, 'currentTokenEstimation'),
            timePeriod: requireText(data.timePeriod, 'timePeriod'),
            periodSpend: requireNumericText(data.periodSpend, 'periodSpend', { decimal: true }),
            periodApiCalls: requireNumericText(data.periodApiCalls, 'periodApiCalls'),
            periodTokens: requireNumericText(data.periodTokens, 'periodTokens'),
        }];
    },
});
