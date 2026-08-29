/**
 * che168 car — detail of one used-car listing by its info id.
 *
 * Like `browse`, the detail page (`www.che168.com/dealer/<dealer>/<info>.html`)
 * is anti-bot gated, so this navigates the logged-in browser and extracts the
 * rendered DOM: the sale price (`.price-present` / `.num-price`) and the spec
 * sheet (`ul.basic-item-ul > li`, each `span.item-name` + value). Returns a
 * field/value sheet. The extractor is a pure top-level function, unit-tested
 * against a frozen fixture.
 */

import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    AuthRequiredError,
    CAR_COLUMNS,
    CommandExecutionError,
    EmptyResultError,
    normalizeInfoId,
    resolveCarUrl,
} from './utils.js';

/**
 * Pure DOM extractor for the che168 used-car detail page. Bare `document` so
 * it runs in both the live browser and JSDOM unit tests.
 */
export function extractCarDetail() {
    const fields = [];
    const push = (field, value) => fields.push({
        field,
        value: value == null ? '' : String(value).replace(/[ ]/g, ' ').replace(/\s+/g, ' ').trim(),
    });

    let title = '';
    const h = document.querySelector('h3.car-brand-name, .car-box h3, .detail-name, h1');
    if (h) title = h.textContent.replace(/\s+/g, ' ').trim();
    if (!title) {
        // title is "【北京】理想i6 2025款 四驱标准版_25.2800_二手车之家"
        title = (document.title || '').replace(/^【[^】]*】/, '').split('_')[0].trim();
    }

    let price = '';
    const pp = document.querySelector('.price-present');
    if (pp) price = pp.textContent.replace(/[¥￥\s]/g, '').trim();
    if (!price) {
        const np = document.querySelector('.num-price');
        if (np) price = `${np.textContent.trim()}万`;
    }

    let down = '';
    const dp = document.querySelector('.downpaymentprice');
    if (dp) {
        const d = dp.getAttribute('data-downpaymentprice') || dp.textContent;
        const dm = String(d || '').match(/[\d.]+/);
        if (dm) down = `${dm[0]}万`;
    }

    // Spec rows: each <li><span class="item-name">LABEL</span>VALUE</li>.
    const specs = {};
    for (const li of Array.from(document.querySelectorAll('ul.basic-item-ul li'))) {
        const nameEl = li.querySelector('.item-name');
        if (!nameEl) continue;
        const label = nameEl.textContent.replace(/[\s ]/g, '');
        let val = li.textContent.replace(/[ ]/g, '');
        val = val.replace(nameEl.textContent.replace(/[ ]/g, ''), '').replace(/\s+/g, ' ').trim();
        if (label && val && !(label in specs)) specs[label] = val;
    }

    push('title', title);
    push('price', price);
    push('down_payment', down);
    push('reg_date', specs['上牌时间'] || '');
    push('mileage', specs['表显里程'] || '');
    push('gearbox', specs['变速箱'] || '');
    push('fuel', specs['燃料类型'] || '');
    push('transfers', specs['过户次数'] || '');
    push('location', specs['所在地'] || '');
    push('publish_date', specs['发布时间'] || '');
    push('url', (location.href || '').split('#')[0]);
    return fields;
}

cli({
    site: 'che168',
    name: 'car',
    access: 'read',
    aliases: ['detail'],
    description: '车168/汽车之家二手车车源详情（售价/首付/上牌/里程/变速箱/过户/所在地）',
    domain: 'www.che168.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'url', required: true, positional: true, help: 'che168 车源详情 URL（来自 browse 的 url 列，含 /dealer/<dealer>/<info_id>.html）' },
    ],
    columns: CAR_COLUMNS,
    func: async (page, args) => {
        const url = resolveCarUrl(args.url);
        const infoId = normalizeInfoId(args.url);
        try {
            await page.goto(url);
            await page.wait(3);
        } catch (err) {
            throw new CommandExecutionError(`che168 car ${infoId} navigation failed: ${err?.message || err}`);
        }

        const rows = await page.evaluate(`(${extractCarDetail.toString()})()`);
        const map = Object.fromEntries((rows || []).map((r) => [r.field, r.value]));
        if (!map.title && !map.price) {
            const info = await page.evaluate('({title: document.title, body: (document.body && document.body.innerText || "").slice(0, 400)})');
            if (/验证|安全|滑动|登录/.test(info?.body || '')) {
                throw new AuthRequiredError('che168.com', `che168 car ${infoId} hit an anti-bot/login wall.`);
            }
            throw new EmptyResultError(`che168 car ${infoId}`, 'No listing detail — the car may be sold/removed, or the id is wrong.');
        }
        return rows;
    },
});
