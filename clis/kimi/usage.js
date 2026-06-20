// Kimi Code console usage summary.
// Reads the four dashboard cards from https://www.kimi.com/code/console

import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    CommandExecutionError,
} from '@jackwener/opencli/errors';

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

function requireCard(cards, name) {
    const values = cards[name];
    if (!Array.isArray(values) || values.length === 0) {
        throw new CommandExecutionError(`kimi usage returned malformed payload: missing "${name}" card`);
    }
    const normalized = values.map((value) => String(value || '').trim()).filter(Boolean);
    if (normalized.length === 0) {
        throw new CommandExecutionError(`kimi usage returned malformed payload: missing "${name}" card`);
    }
    return normalized;
}

function requirePct(values, name) {
    const pct = parsePct(values[0]);
    if (!Number.isFinite(pct)) {
        throw new CommandExecutionError(`kimi usage returned malformed payload: "${name}" card is missing a percentage`);
    }
    return pct;
}

cli({
    site: 'kimi',
    name: 'usage',
    access: 'read',
    description: 'Read Kimi Code console usage cards: weekly quota, rate limit, membership, and model permission.',
    domain: KIMI_DOMAIN,
    strategy: Strategy.COOKIE,
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

        if (!cards || typeof cards !== 'object' || Array.isArray(cards)) {
            throw new CommandExecutionError('kimi usage returned malformed payload: usage cards must be an object');
        }
        if (Object.keys(cards).length === 0) {
            throw new CommandExecutionError('kimi usage returned malformed payload: no usage cards found on the console page');
        }

        const weekly = requireCard(cards, '本周用量');
        const rate = requireCard(cards, '频限明细');
        const member = requireCard(cards, '我的权益');
        const model = requireCard(cards, '模型权限');
        const weeklyUsagePct = requirePct(weekly, '本周用量');
        const rateLimitPct = requirePct(rate, '频限明细');

        return [{
            weeklyUsagePct,
            weeklyResetIn: weekly.find((t) => /重置/.test(t)) || null,
            rateLimitPct,
            rateLimitResetIn: rate.find((t) => /重置/.test(t)) || null,
            membershipName: member[0] || null,
            membershipTier: member.find((t) => t !== member[0]) || null,
            modelPermission: model[0] || null,
            modelCost: model.find((t) => t !== model[0]) || null,
        }];
    },
});
