// Kimi Code console usage summary.
// Reads the four dashboard cards from https://www.kimi.com/code/console

import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';

const KIMI_DOMAIN = 'kimi.com';
const KIMI_URL = 'https://www.kimi.com/';
const CONSOLE_URL = `${KIMI_URL}code/console`;

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

const CATEGORIES = ['本周用量', '频限明细', '我的权益', '模型权限'];

function parsePct(value) {
    const m = String(value || '').match(/(\d+(?:\.\d+)?)\s*%/);
    return m ? Number(m[1]) : null;
}

cli({
    site: 'kimi',
    name: 'code-console',
    access: 'read',
    description: 'Read Kimi Code console usage cards: weekly quota, rate limit, membership, and model permission.',
    domain: KIMI_DOMAIN,
    strategy: Strategy.UI,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: true,
    args: [],
    columns: [
        'weeklyUsagePct',
        'weeklyResetIn',
        'rateLimitPct',
        'rateLimitResetIn',
        'membershipName',
        'membershipTier',
        'modelPermission',
        'modelCost',
    ],
    func: async (page) => {
        await page.goto(CONSOLE_URL);
        await page.wait(3);

        const cards = await page.evaluate(`(() => {
            ${IS_VISIBLE_JS}

            const getDirectText = (el) => {
                let text = '';
                for (const node of el.childNodes) {
                    if (node.nodeType === Node.TEXT_NODE) text += node.textContent;
                }
                return text.trim();
            };

            const cards = {};
            const section = document.querySelector('section');
            if (!section) return cards;

            // The first child of the first <section> holds the 4 dashboard cards.
            const cardContainer = section.children[0];
            if (!cardContainer) return cards;

            const cardDivs = Array.from(cardContainer.children).filter(isVisible).slice(0, 4);
            for (const card of cardDivs) {
                const header = card.children[0];
                const body = card.children[1];
                if (!header || !body) continue;

                const categoryEl = header.querySelector('p');
                const category = categoryEl ? getDirectText(categoryEl) : '';
                if (!category || !${JSON.stringify(CATEGORIES)}.includes(category)) continue;

                const values = [...new Set(
                    Array.from(body.querySelectorAll('span, p, div'))
                        .filter(isVisible)
                        .map(getDirectText)
                        .filter((t) => t)
                )];

                if (values.length > 0) {
                    cards[category] = values.slice(0, 3);
                }
            }
            return cards;
        })()`);

        if (!cards || Object.keys(cards).length === 0) {
            throw new EmptyResultError('kimi code-console', 'No usage cards found on the console page');
        }

        const weekly = cards['本周用量'] || [];
        const rate = cards['频限明细'] || [];
        const member = cards['我的权益'] || [];
        const model = cards['模型权限'] || [];

        return [{
            weeklyUsagePct: parsePct(weekly[0]),
            weeklyResetIn: weekly.find((t) => /重置/.test(t)) || null,
            rateLimitPct: parsePct(rate[0]),
            rateLimitResetIn: rate.find((t) => /重置/.test(t)) || null,
            membershipName: member[0] || null,
            membershipTier: member.find((t) => t !== member[0]) || null,
            modelPermission: model[0] || null,
            modelCost: model.find((t) => t !== model[0]) || null,
        }];
    },
});
