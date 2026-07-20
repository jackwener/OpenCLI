/**
 * 携程邮轮 search: cruise packages by departure port name.
 *
 * Ctrip's cruise search results live on the legacy `newpackage/search/sN.html`
 * pages, keyed by an opaque per-port code `sN`. Those pages list every port as a
 * link, so the command first navigates a stable port page (上海港, `s2`) to
 * resolve the requested port name to its `sN` code, then loads that port's
 * results and reads the `.route_info` cards (see helpers in utils).
 */
import { AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    WAIT_FOR_CRUISE_JS,
    buildCruiseExtractJs,
    buildCruisePortLookupJs,
    buildCruiseSearchUrl,
    parseListLimit,
    parsePlaceName,
} from './utils.js';

// 上海港 lists every departure port as a link, so it doubles as the port-code index.
const PORT_INDEX_CODE = '2';

cli({
    site: 'ctrip',
    name: 'cruise',
    access: 'read',
    description: '搜索携程邮轮线路（按出发港名）',
    domain: 'cruise.ctrip.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'port', required: true, positional: true, help: 'Departure cruise port name (e.g. 上海 / 威尼斯 / 罗马)' },
        { name: 'limit', default: 20, help: 'Number of cruises (1-50)' },
    ],
    columns: [
        'rank',
        'title', 'star',
        'boarding', 'sailingDate',
        'tags', 'price',
        'url',
    ],
    func: async (page, kwargs) => {
        const port = parsePlaceName('port', kwargs.port);
        const limit = parseListLimit(kwargs.limit);

        const indexUrl = buildCruiseSearchUrl(PORT_INDEX_CODE);
        await page.goto(indexUrl);
        const indexWait = await page.evaluate(WAIT_FOR_CRUISE_JS);
        if (indexWait === 'captcha') {
            throw new AuthRequiredError('cruise.ctrip.com', 'Ctrip is asking for a captcha; complete it in your browser session and retry');
        }
        if (indexWait !== 'content') {
            throw new CommandExecutionError(`Ctrip cruise page did not render (state=${String(indexWait)})`);
        }
        const portCode = await page.evaluate(buildCruisePortLookupJs(port));
        if (!portCode) {
            throw new EmptyResultError('ctrip cruise', `No cruise departure port matching "${port}" (try a listed sea-cruise port like 上海 / 威尼斯 / 罗马)`);
        }

        let searchUrl = indexUrl;
        if (portCode !== PORT_INDEX_CODE) {
            searchUrl = buildCruiseSearchUrl(portCode);
            await page.goto(searchUrl);
            const portWait = await page.evaluate(WAIT_FOR_CRUISE_JS);
            if (portWait === 'captcha') {
                throw new AuthRequiredError('cruise.ctrip.com', 'Ctrip is asking for a captcha; complete it in your browser session and retry');
            }
            if (portWait === 'empty') {
                throw new EmptyResultError('ctrip cruise', `No cruises currently departing "${port}"`);
            }
            if (portWait !== 'content') {
                throw new CommandExecutionError(`Ctrip cruise port page did not render (state=${String(portWait)})`);
            }
        }

        const raw = await page.evaluate(buildCruiseExtractJs());
        if (!Array.isArray(raw)) {
            throw new CommandExecutionError('Ctrip cruise DOM extraction returned malformed rows');
        }
        if (raw.length === 0) {
            throw new CommandExecutionError('Ctrip cruise cards rendered but parser did not find required itinerary anchors');
        }
        return raw.slice(0, limit).map((r, i) => ({
            rank: i + 1,
            title: r.title,
            star: r.star,
            boarding: r.boarding,
            sailingDate: r.sailingDate,
            tags: r.tags,
            price: r.price,
            url: searchUrl,
        }));
    },
});
