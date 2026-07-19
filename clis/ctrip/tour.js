/**
 * 携程旅游 search: group and self-guided tour packages by destination keyword.
 *
 * Ctrip's vacations search renders results server-side into `.list_product_item`
 * cards keyed by stable class fields, so this navigates the `sv=<destination>`
 * search URL and reads by selector (see `buildTourExtractJs` in utils). A
 * destination with no matching packages raises `EmptyResultError`.
 */
import { AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    WAIT_FOR_TOURS_JS,
    buildTourExtractJs,
    buildTourListUrl,
    parseStationName,
    parseTrainLimit,
} from './utils.js';

cli({
    site: 'ctrip',
    name: 'tour',
    access: 'read',
    description: '搜索携程旅游线路（按目的地关键词，跟团/自由行）',
    domain: 'vacations.ctrip.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'destination', required: true, positional: true, help: 'Destination keyword (e.g. 北京 / 三亚 / 马尔代夫)' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of packages (1-50)' },
    ],
    columns: [
        'rank',
        'title', 'subtitle',
        'tags', 'score', 'sold', 'reviews',
        'price',
        'url',
    ],
    func: async (page, kwargs) => {
        const destination = parseStationName('destination', kwargs.destination);
        const limit = parseTrainLimit(kwargs.limit);

        const searchUrl = buildTourListUrl(destination);
        await page.goto(searchUrl);
        const waitResult = await page.evaluate(WAIT_FOR_TOURS_JS);
        if (waitResult === 'captcha') {
            throw new AuthRequiredError('vacations.ctrip.com', 'Ctrip is asking for a captcha; complete it in your browser session and retry');
        }
        if (waitResult === 'empty') {
            throw new EmptyResultError('ctrip tour', `No tour packages for "${destination}"`);
        }
        if (waitResult !== 'content') {
            throw new CommandExecutionError(`Ctrip tour page did not render package cards (state=${String(waitResult)})`);
        }
        const raw = await page.evaluate(buildTourExtractJs());
        if (!Array.isArray(raw)) {
            throw new CommandExecutionError('Ctrip tour DOM extraction returned malformed rows');
        }
        if (raw.length === 0) {
            throw new EmptyResultError('ctrip tour', `No tour packages for "${destination}"`);
        }
        return raw.slice(0, limit).map((r, i) => ({
            rank: i + 1,
            title: r.title,
            subtitle: r.subtitle,
            tags: r.tags,
            score: r.score,
            sold: r.sold,
            reviews: r.reviews,
            price: r.price,
            url: searchUrl,
        }));
    },
});
