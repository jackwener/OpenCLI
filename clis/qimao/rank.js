import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { QIMAO_DOMAIN, buildRankUrl, cleanText, requireLimit, stripHtml } from './utils.js';
import { getRankChoiceOptions, normalizeRankOptionRows, resolveRankChoice } from './rank.shared.js';

function firstDefined(...values) {
    return values.find((value) => cleanText(value));
}

export function normalizeRankRow(item, rank) {
    return {
        rank,
        book_id: cleanText(item?.book_id),
        title: cleanText(item?.title),
        author: cleanText(item?.author),
        category1: cleanText(item?.category1_name),
        category: cleanText(item?.category2_name),
        status: String(item?.is_over) === '1' ? '完结' : '连载中',
        words: cleanText(item?.words_num),
        latest_chapter: cleanText(item?.latest_chapter_title),
        updated_at: cleanText(item?.update_time),
        hot_value: firstDefined(item?.number, item?.bonus),
        hot_unit: cleanText(item?.unit),
        url: cleanText(item?.book_url),
        intro: stripHtml(item?.intro),
    };
}

async function extractRankSnapshot(page) {
    return page.evaluate(`(() => {
      const root = (window.__NUXT__ && window.__NUXT__.fetch) || {};
      const fetchKey = Object.keys(root).find((key) => key.includes('data-v-cca2d2e4'));
      const payload = fetchKey ? root[fetchKey] : null;
      return {
        listData: Array.isArray(payload?.listData) ? payload.listData : [],
      };
    })()`);
}

cli({
    site: 'qimao',
    name: 'rank',
    access: 'read',
    description: 'Read Qimao ranking lists',
    domain: QIMAO_DOMAIN,
    strategy: Strategy.PUBLIC,
    browser: true,
    navigateBefore: buildRankUrl(),
    args: [
        { name: 'channel', help: 'boy/girl or 男生/女生' },
        { name: 'type', help: 'hot/new/over/collect/update or 大热榜/新书榜/完结榜/收藏榜/更新榜' },
        { name: 'period', help: 'date/month or 日榜/月榜' },
        { name: 'limit', type: 'int', default: 20, help: 'Max rows to return (1-50)' },
    ],
    columns: ['rank', 'book_id', 'title', 'author', 'category1', 'category', 'status', 'words', 'latest_chapter', 'updated_at', 'hot_value', 'hot_unit', 'url', 'intro'],
    func: async (page, args) => {
        const choices = getRankChoiceOptions();
        const channel = resolveRankChoice(args.channel, choices.channel, 'boy', 'channel');
        const type = resolveRankChoice(args.type, choices.type, 'hot', 'type');
        const period = resolveRankChoice(args.period, choices.period, 'date', 'period');
        const limit = requireLimit(args.limit, 20, 50);
        await page.goto(buildRankUrl(channel, type, period), { waitUntil: 'load', settleMs: 2000 });
        await page.wait({ time: 1 });
        const snapshot = await extractRankSnapshot(page);
        const list = Array.isArray(snapshot?.listData) ? snapshot.listData : [];
        if (list.length === 0) {
            throw new EmptyResultError('qimao rank', 'Qimao returned no ranking rows.');
        }
        return list.slice(0, limit).map((item, index) => normalizeRankRow(item, index + 1));
    },
});

export const __test__ = {
    normalizeRankRow,
    normalizeRankOptionRows,
};
