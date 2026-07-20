// Kimi membership quota usage summary.
// Reads usage cards from https://www.kimi.com/membership/subscription?tab=quota

import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';

const KIMI_DOMAIN = 'kimi.com';
const QUOTA_URL = 'https://www.kimi.com/membership/subscription?tab=quota';

const IS_VISIBLE_JS = `
  const isVisible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') return false;
    return true;
  };
`;

function parsePct(value) {
    const m = String(value || '').match(/(\d+(?:\.\d+)?)\s*%/);
    return m ? Number(m[1]) : null;
}

function normalize(s) {
    return String(s || '').trim();
}

function requireFinite(value, name) {
    if (!Number.isFinite(value)) {
        throw new CommandExecutionError(`kimi usage returned malformed payload: missing or invalid "${name}"`);
    }
    return value;
}

function requireText(value, name) {
    const text = normalize(value);
    if (!text) {
        throw new CommandExecutionError(`kimi usage returned malformed payload: missing "${name}"`);
    }
    return text;
}

cli({
    site: 'kimi',
    name: 'usage',
    access: 'read',
    description: 'Read Kimi membership quota usage from the subscription page: total usage, rate limits, gift quota, and booster balance.',
    domain: KIMI_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: true,
    args: [],
    columns: [
        'membershipName',
        'membershipValidUntil',
        'totalUsagePct',
        'totalResetIn',
        'fiveHourUsagePct',
        'fiveHourResetIn',
        'sevenDayUsagePct',
        'sevenDayResetIn',
        'giftUsagePct',
        'giftValidUntil',
        'balance',
        'monthlySpend',
    ],
    func: async (page) => {
        await page.goto(QUOTA_URL);
        await page.wait(3);

        const data = await page.evaluate(`(() => {
            ${IS_VISIBLE_JS}

            const result = {};

            // Usage sections: total, 5-hour, 7-day, gift
            const sections = Array.from(document.querySelectorAll('.usage-section')).filter(isVisible);
            for (const section of sections) {
                const titleEl = section.querySelector('.usage-section-title');
                const contentEl = section.querySelector('.usage-section-content');
                if (!titleEl || !contentEl) continue;

                const titleSpans = Array.from(titleEl.querySelectorAll('span'))
                    .filter(isVisible)
                    .map((s) => s.textContent.trim());
                const label = titleSpans[0] || '';
                const pct = titleSpans[1] || '';
                const contentText = contentEl.innerText.trim().replace(/\\s+/g, ' ');

                if (label === '总使用量') {
                    if (contentText.includes('后重置')) {
                        result.totalUsagePct = pct;
                        const m = contentText.match(/Kimi\\s*Code\\s*(.+)/);
                        result.totalResetIn = m ? m[1].trim() : null;
                    } else if (contentText.includes('截止至')) {
                        result.giftUsagePct = pct;
                        const m = contentText.match(/截止至\\s*(.+)/);
                        result.giftValidUntil = m ? m[1].trim() : null;
                    }
                } else if (label === '5 小时用量') {
                    const m = contentText.match(/Code\\s+([\\d.]+)%\\s*(.+)/);
                    if (m) {
                        result.fiveHourUsagePct = m[1] + '%';
                        result.fiveHourResetIn = m[2].trim();
                    }
                } else if (label === '7 天用量') {
                    const m = contentText.match(/Code\\s+([\\d.]+)%\\s*(.+)/);
                    if (m) {
                        result.sevenDayUsagePct = m[1] + '%';
                        result.sevenDayResetIn = m[2].trim();
                    }
                }
            }

            // Booster balance
            const booster = document.querySelector('.booster');
            if (booster && isVisible(booster)) {
                const text = booster.innerText.trim().replace(/\\s+/g, ' ');
                const balanceMatch = text.match(/当前余额\\s*¥\\s*([\\d.]+)/);
                const spendMatch = text.match(/本月消费\\s*¥\\s*([\\d.]+)\\s*\\/\\s*(.+)/);
                result.balance = balanceMatch ? '¥' + balanceMatch[1] : null;
                result.monthlySpend = spendMatch ? '¥' + spendMatch[1] + ' / ' + spendMatch[2].trim() : null;
            }

            // Membership header
            const h1 = document.querySelector('h1');
            result.membershipName = h1 ? h1.textContent.trim() : null;

            const bodyText = document.body.innerText.trim().replace(/\\s+/g, ' ');
            const validMatch = bodyText.match(/有效期至：\\s*(\\d{4}-\\d{2}-\\d{2})/);
            result.membershipValidUntil = validMatch ? validMatch[1] : null;

            return result;
        })()`);

        if (!data || typeof data !== 'object' || Array.isArray(data)) {
            throw new CommandExecutionError('kimi usage returned malformed payload: expected object');
        }

        return [{
            membershipName: normalize(data.membershipName) || null,
            membershipValidUntil: data.membershipValidUntil || null,
            totalUsagePct: requireFinite(parsePct(data.totalUsagePct), 'totalUsagePct'),
            totalResetIn: requireText(data.totalResetIn, 'totalResetIn'),
            fiveHourUsagePct: requireFinite(parsePct(data.fiveHourUsagePct), 'fiveHourUsagePct'),
            fiveHourResetIn: requireText(data.fiveHourResetIn, 'fiveHourResetIn'),
            sevenDayUsagePct: requireFinite(parsePct(data.sevenDayUsagePct), 'sevenDayUsagePct'),
            sevenDayResetIn: requireText(data.sevenDayResetIn, 'sevenDayResetIn'),
            giftUsagePct: parsePct(data.giftUsagePct),
            giftValidUntil: normalize(data.giftValidUntil) || null,
            balance: normalize(data.balance) || null,
            monthlySpend: normalize(data.monthlySpend) || null,
        }];
    },
});
