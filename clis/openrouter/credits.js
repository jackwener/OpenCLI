// OpenRouter credits balance summary.
// Reads the "Total available credits" balance from the settings/credits page.
// The value is exposed as an aria-label on the balance card, so we extract it
// from the DOM instead of relying on an undocumented internal API.

import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';

const OR_DOMAIN = 'openrouter.ai';
const CREDITS_URL = 'https://openrouter.ai/settings/credits';

// Runs in the browser via page.evaluate. Backslashes are doubled because this
// string is interpolated into a template literal.
const EVAL_JS = `
    var el = document.querySelector('[aria-label^="Total available credits:"]');
    var total = null;
    var currency = null;

    if (el) {
        var label = el.getAttribute('aria-label') || '';
        var m = label.match(/Total available credits:\\s*\\$?\\s*([\\d,.]+)/);
        if (m) {
            total = m[1].replace(/,/g, '');
            currency = 'USD';
        }
    }

    // Fallback: scan the balance card text for a currency amount
    if (total === null && el) {
        var text = el.innerText || '';
        var tm = text.match(/([\\d,.]+)/);
        if (tm) total = tm[1].replace(/,/g, '');
    }

    return { totalAvailable: total, currency: currency };
`;

cli({
    site: 'openrouter',
    name: 'credits',
    access: 'read',
    description: 'Read the OpenRouter total available credits balance from the settings/credits page.',
    domain: OR_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: true,
    args: [],
    columns: [
        'totalAvailable',
        'currency',
    ],
    func: async (page) => {
        await page.goto(CREDITS_URL);
        await page.wait(3);

        const data = await page.evaluate(`(() => {${EVAL_JS}})()`);

        if (!data || typeof data !== 'object' || Array.isArray(data)) {
            throw new CommandExecutionError('openrouter credits returned malformed payload: expected object');
        }
        if (!data.totalAvailable) {
            throw new CommandExecutionError('openrouter credits returned malformed payload: missing totalAvailable balance');
        }

        return [{
            totalAvailable: String(data.totalAvailable),
            currency: String(data.currency || 'USD'),
        }];
    },
});
