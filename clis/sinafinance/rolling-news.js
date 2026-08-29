/**
 * Sina Finance rolling news feed.
 *
 * The roll page itself loads this public JSON endpoint and renders the rows.
 * Calling it directly avoids a browser launch and preserves the visible page
 * contract (财经 column, title, China-local timestamp, article URL).
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

const ROLL_API = 'https://feed.mix.sina.com.cn/api/roll/get';

function pad2(value) {
    return String(value).padStart(2, '0');
}

function formatRollTimestamp(value) {
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds <= 0)
        return '';
    // Sina's roll page presents finance news in China Standard Time.
    const date = new Date(seconds * 1000 + 8 * 60 * 60 * 1000);
    return `${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())} ${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}`;
}

function normalizeRollRows(payload) {
    if (payload?.result?.status?.code !== 0) {
        throw new CommandExecutionError(`Sina Finance rolling news API failed: ${payload?.result?.status?.msg || 'unknown status'}`);
    }
    const items = payload?.result?.data;
    if (!Array.isArray(items)) {
        throw new CommandExecutionError('Sina Finance rolling news API returned malformed data');
    }
    if (items.length === 0) {
        throw new EmptyResultError('sinafinance rolling-news');
    }
    return items.map((item, index) => {
        const title = typeof item?.title === 'string' ? item.title.trim() : '';
        const url = typeof item?.url === 'string' ? item.url.trim() : '';
        const date = formatRollTimestamp(item?.ctime);
        if (!title || !url || !date) {
            throw new CommandExecutionError(`Sina Finance rolling news API returned malformed row ${index + 1}`);
        }
        return {
            column: '财经',
            title,
            date,
            url,
        };
    });
}

cli({
    site: 'sinafinance',
    name: 'rolling-news',
    access: 'read',
    description: '新浪财经滚动新闻',
    domain: 'feed.mix.sina.com.cn',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [],
    columns: ['column', 'title', 'date', 'url'],
    func: async () => {
        const params = new URLSearchParams({
            pageid: '384',
            lid: '2519',
            k: '',
            num: '50',
            page: '1',
        });
        let response;
        try {
            response = await fetch(`${ROLL_API}?${params}`);
        }
        catch (error) {
            throw new CommandExecutionError(`Sina Finance rolling news request failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (!response.ok) {
            throw new CommandExecutionError(`Sina Finance rolling news API returned HTTP ${response.status}`);
        }
        let payload;
        try {
            payload = await response.json();
        }
        catch (error) {
            throw new CommandExecutionError(`Sina Finance rolling news API returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
        }
        return normalizeRollRows(payload);
    },
});
