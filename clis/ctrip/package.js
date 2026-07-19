/**
 * 携程机+酒 search: flight-plus-hotel (自由行) packages by destination keyword.
 *
 * The freetravel tab of Ctrip's vacations search renders the same
 * `.list_product_item` cards as `tour`, so this reuses the shared vacations
 * extractor and wait helper against the `freetravel` search section. A
 * destination with no packages raises `EmptyResultError`.
 */
import { AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    WAIT_FOR_VACATIONS_JS,
    buildPackageListUrl,
    buildVacationsExtractJs,
    parseListLimit,
    parsePlaceName,
} from './utils.js';

cli({
    site: 'ctrip',
    name: 'package',
    access: 'read',
    description: '搜索携程机+酒自由行套餐（按目的地关键词）',
    domain: 'vacations.ctrip.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'destination', required: true, positional: true, help: 'Destination keyword (e.g. 三亚 / 北京 / 曼谷)' },
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
        const destination = parsePlaceName('destination', kwargs.destination);
        const limit = parseListLimit(kwargs.limit);

        const searchUrl = buildPackageListUrl(destination);
        await page.goto(searchUrl);
        const waitResult = await page.evaluate(WAIT_FOR_VACATIONS_JS);
        if (waitResult === 'captcha') {
            throw new AuthRequiredError('vacations.ctrip.com', 'Ctrip is asking for a captcha; complete it in your browser session and retry');
        }
        if (waitResult === 'empty') {
            throw new EmptyResultError('ctrip package', `No flight-plus-hotel packages for "${destination}"`);
        }
        if (waitResult !== 'content') {
            throw new CommandExecutionError(`Ctrip package page did not render package cards (state=${String(waitResult)})`);
        }
        const raw = await page.evaluate(buildVacationsExtractJs());
        if (!Array.isArray(raw)) {
            throw new CommandExecutionError('Ctrip package DOM extraction returned malformed rows');
        }
        if (raw.length === 0) {
            throw new CommandExecutionError('Ctrip package cards rendered but parser did not find required package anchors');
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
