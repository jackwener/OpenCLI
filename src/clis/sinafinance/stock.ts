/**
 * Sinafinance quote stock
 * A股 / 港股 / 美股
 */

import { cli, Strategy } from '../../registry.js';
import { CliError } from '../../errors.js';

const MARKET_CN = '11';
const MARKET_HK = '31';
const MARKET_US = '41';

cli({
  site: 'sinafinance',
  name: 'stock',
  description: '新浪财经行情',
  domain: 'finance.sina.cn',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'key', type: 'string', required: true, positional: true, help: 'stock name or code to search' },
    { name: 'market', type: 'string', default: 'auto', help: 'Market: cn, hk, us, auto(default). auto searches cn → hk → us in order' },
  ],
  columns: ['Symbol', 'Name', 'Price', 'Change', 'ChangePercent', 'Open', 'High', 'Low', 'Volume', 'MarketCap'],
  func: async (page, args) => {
    await page.goto('https://finance.sina.com.cn/stock/');
    await page.wait({ selector: '#suggest01_input', timeout: 10000 });

    // Use JSON.stringify to safely pass user input into the browser context
    const searchKey = JSON.stringify(String(args.key));
    const searchMarket = JSON.stringify(String(args.market));

    const suggestRes = await page.evaluate(`
      (async() => {
        const searchKey = ${searchKey};
        const searchMarket = ${searchMarket};
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        const waitForElement = async (selector, timeout = 5000) => {
          const start = Date.now();
          while (Date.now() - start < timeout) {
            const el = document.querySelector(selector);
            if (el) return el;
            await sleep(100);
          }
          return null;
        };
        const inputEl = document.getElementById('suggest01_input');
        if (!inputEl) return null;
        inputEl.focus();
        inputEl.value = searchKey;
        inputEl.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: '0', code: 'Digit0' }));
        inputEl.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: '0', code: 'Digit0' }));
        inputEl.dispatchEvent(new Event('change', { bubbles: true }));
        await sleep(500);
        const suggestDOM = await waitForElement('#fcSuggest_140418');
        if (!suggestDOM) return null;
        const table = suggestDOM.previousElementSibling;
        if (!table || table.tagName !== 'TABLE') return null;
        const marketMap = { cn: '${MARKET_CN}', hk: '${MARKET_HK}', us: '${MARKET_US}' };
        const targetMarket = marketMap[searchMarket] || 'auto';
        const results = [];
        const matchedRes = [];
        const rows = table.querySelectorAll('tr');
        for (const tr of rows) {
          const id = tr.id;
          if (!id) continue;
          const idParts = id.split(',');
          const stockName = idParts[0] || '';
          const market = idParts[1] || '';
          const symbol = idParts[3] || '';
          if (!['${MARKET_CN}', '${MARKET_HK}', '${MARKET_US}'].includes(market)) continue;
          const firstTd = tr.querySelector('td:first-child');
          if (!firstTd) continue;
          const a = firstTd.querySelector('a');
          if (!a) continue;
          let link = a.getAttribute('href') || '';
          if (link.startsWith('//')) link = 'https:' + link;
          results.push({ stockName, market, symbol, link });
        }
        for (const item of results) {
          const name = item.stockName.toLowerCase();
          const key = searchKey.toLowerCase();
          let hitRate = 0;
          if (name.includes(key)) hitRate = key.length / name.length;
          if (hitRate >= 0.5) matchedRes.push({ url: item.link, market: item.market, hitRate });
        }
        matchedRes.sort((a, b) => b.hitRate - a.hitRate);
        if (matchedRes.length === 0) return null;
        if (targetMarket !== 'auto') {
          const candidates = matchedRes.filter(item => item.market === targetMarket);
          if (candidates.length === 0) return null;
          return candidates.reduce((best, curr) => curr.hitRate > best.hitRate ? curr : best);
        }
        const maxHitRate = Math.max(...matchedRes.map(item => item.hitRate));
        const topCandidates = matchedRes.filter(item => item.hitRate === maxHitRate);
        for (const m of ['${MARKET_CN}', '${MARKET_HK}', '${MARKET_US}']) {
          const found = topCandidates.find(item => item.market === m);
          if (found) return found;
        }
        return topCandidates[0];
      })()
    `);

    if (!suggestRes) {
      throw new CliError('NOT_FOUND', `No stock found for "${args.key}"`, 'Try a different name or code');
    }

    await page.goto((suggestRes as { url: string }).url);
    await page.wait({ selector: '#hqDetails, .deta03, #hqPrice', timeout: 10000 });

    const market = (suggestRes as { market: string }).market;
    let payload: unknown;

    if (market === MARKET_HK) {
      payload = await page.evaluate(`
        (() => {
          function getFieldValueFromLi(labelText) {
            const li = Array.from(document.querySelectorAll('.deta03 li'))
              .find(el => (el.textContent || '').replace(/[\\s\\uFEFF\\xA0]+$/g, '').startsWith(labelText));
            return li?.querySelector('span')?.textContent?.trim() || '';
          }
          const changeText = document.getElementById('mts_stock_hk_zdf')?.textContent || '';
          const changeParts = changeText.replace(/[（）()]/g, ' ').trim().split(/\\s+/);
          return {
            Symbol: document.getElementById('stock_sy')?.textContent || '',
            Name: document.getElementById('stock_cname')?.textContent || '',
            Price: document.getElementById('mts_stock_hk_price')?.textContent || '',
            Change: changeParts[0] || '',
            ChangePercent: changeParts[1] || '',
            Open: getFieldValueFromLi('今开盘'),
            High: getFieldValueFromLi('最高价'),
            Low: getFieldValueFromLi('最低价'),
            Volume: getFieldValueFromLi('成交量'),
            MarketCap: getFieldValueFromLi('港股市值'),
          };
        })()
      `);
    } else if (market === MARKET_CN) {
      payload = await page.evaluate(`
        (() => {
          const getFieldValue = (labelText) => {
            const th = Array.from(document.querySelectorAll('#hqDetails th'))
              .find(el => el.textContent.trim().includes(labelText));
            return th?.nextElementSibling?.textContent?.trim() || '';
          };
          return {
            Symbol: document.querySelector('#stockName span')?.textContent?.replace(/[()]/g, '') || '',
            Name: document.querySelector('#stockName i')?.textContent || '',
            Price: document.getElementById('price')?.textContent || '',
            Change: document.getElementById('change')?.textContent || '',
            ChangePercent: document.getElementById('changeP')?.textContent || '',
            Open: getFieldValue('今  开'),
            High: getFieldValue('最  高'),
            Low: getFieldValue('最  低'),
            Volume: getFieldValue('成交量'),
            MarketCap: getFieldValue('总市值'),
          };
        })()
      `);
    } else if (market === MARKET_US) {
      payload = await page.evaluate(`
        (() => {
          const cleanText = (text) => text ? text.replace(/[\\t\\n\\r]/g, '').trim() : '';
          const h1Text = cleanText(document.querySelector('.name h1')?.textContent || '');
          const h1Parts = h1Text.split(/\\s+/);
          const symbolText = (h1Parts[1] || '').split(':')[1] || '';
          const changeText = cleanText(document.querySelector('.hq_change')?.textContent || '');
          const changeMatch = changeText.match(/([+-]?\\d+\\.?\\d*)\\(([+-]?\\d+\\.?\\d*)%\\)/);
          const getFieldValue = (labelText) => {
            const th = Array.from(document.querySelectorAll('#hqDetails th'))
              .find(el => el.textContent.trim().includes(labelText));
            return th?.nextElementSibling?.textContent?.trim() || '';
          };
          const rangeText = getFieldValue('区间');
          const rangeParts = rangeText.split('-');
          return {
            Symbol: symbolText,
            Name: h1Parts[0] || '',
            Price: cleanText(document.getElementById('hqPrice')?.textContent),
            Change: changeMatch ? changeMatch[1] : '',
            ChangePercent: changeMatch ? changeMatch[2] + '%' : changeText,
            Open: getFieldValue('开盘'),
            High: rangeParts[1] ? cleanText(rangeParts[1]) : '',
            Low: rangeParts[0] ? cleanText(rangeParts[0]) : '',
            Volume: getFieldValue('成交量'),
            MarketCap: getFieldValue('市值'),
          };
        })()
      `);
    } else {
      throw new CliError('NOT_FOUND', `Unsupported market code: ${market}`, 'Expected cn, hk, or us');
    }

    if (!payload || typeof payload !== 'object') return [];
    return [payload];
  },
});
