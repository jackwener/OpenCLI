// DeepSeek platform usage summary.
// Reads data from the https://platform.deepseek.com/usage page.
// Uses the internal API for account summary + innerText extraction for time-dimension cards.

import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';

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
        var normalW = (summary.normal_wallets || []).find(function(w) { return w.currency === 'CNY'; });
        var bonusW = (summary.bonus_wallets || []).find(function(w) { return w.currency === 'CNY'; });
        return {
            balance: normalW ? Number(normalW.balance).toFixed(2) : '0',
            bonusBalance: bonusW ? Number(bonusW.balance).toFixed(2) : '0',
            cumulativeSpend: (summary.total_costs || []).length > 0
                ? Number(summary.total_costs[0].amount).toFixed(2) : '0',
            monthlySpend: (summary.monthly_costs || []).length > 0
                ? Number(summary.monthly_costs[0].amount).toFixed(2) : '0',
            monthlyTokens: summary.monthly_token_usage || '0',
            monthlyApiCalls: String(summary.total_usage || 0),
            currentTokenEstimation: summary.total_available_token_estimation || '0',
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
            timePeriod: domData.timePeriod || '近 7 天',
            periodSpend: domData.periodSpend || '0',
            periodApiCalls: domData.periodApiCalls || '0',
            periodTokens: domData.periodTokens || '0',
        };
    });
`;

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

        const data = await page.evaluate(`(() => {${EVAL_JS}})()`);

        if (!data || typeof data !== 'object' || Array.isArray(data)) {
            throw new CommandExecutionError('deepseek usage returned malformed payload: expected object');
        }
        if (data.balance === undefined) {
            throw new CommandExecutionError('deepseek usage returned malformed payload: missing balance');
        }

        return [{
            balance: String(data.balance),
            bonusBalance: String(data.bonusBalance),
            cumulativeSpend: String(data.cumulativeSpend),
            monthlySpend: String(data.monthlySpend),
            monthlyApiCalls: String(data.monthlyApiCalls),
            monthlyTokens: String(data.monthlyTokens),
            currentTokenEstimation: String(data.currentTokenEstimation),
            timePeriod: String(data.timePeriod || '近 7 天'),
            periodSpend: String(data.periodSpend),
            periodApiCalls: String(data.periodApiCalls),
            periodTokens: String(data.periodTokens),
        }];
    },
});
