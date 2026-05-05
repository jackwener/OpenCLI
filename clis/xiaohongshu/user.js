import { cli, Strategy } from '@jackwener/opencli/registry';
import { extractXhsUserNotes, normalizeXhsUserId } from './user-helpers.js';
const DEFAULT_HOME_URL = process.env.OPENCLI_XHS_USER_HOME_URL?.trim() || 'https://www.xiaohongshu.com/explore';
const DEFAULT_HOME_WAIT_SECONDS = Math.max(0, Number(process.env.OPENCLI_XHS_USER_HOME_WAIT_SECONDS ?? 6));
function normalizeXhsHomeUrl(value) {
    const raw = String(value || DEFAULT_HOME_URL).trim();
    try {
        const url = new URL(raw);
        if (!url.hostname.endsWith('xiaohongshu.com')) {
            return DEFAULT_HOME_URL;
        }
        return url.toString();
    }
    catch {
        return DEFAULT_HOME_URL;
    }
}
function toNonNegativeNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
async function readUserSnapshot(page) {
    return await page.evaluate(`
    (() => {
      const safeClone = (value) => {
        try {
          return JSON.parse(JSON.stringify(value ?? null));
        } catch {
          return null;
        }
      };

      const userStore = window.__INITIAL_STATE__?.user || {};
      return {
        noteGroups: safeClone(userStore.notes?._value || userStore.notes || []),
        pageData: safeClone(userStore.userPageData?._value || userStore.userPageData || {}),
      };
    })()
  `);
}
cli({
    site: 'xiaohongshu',
    name: 'user',
    description: 'Get public notes from a Xiaohongshu user profile',
    domain: 'www.xiaohongshu.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'id', type: 'string', required: true, positional: true, help: 'User id or profile URL' },
        { name: 'limit', type: 'int', default: 15, help: 'Number of notes to return' },
        { name: 'home-url', type: 'string', default: DEFAULT_HOME_URL, help: 'Xiaohongshu home page to open before visiting the target profile' },
        { name: 'home-wait-seconds', type: 'number', default: DEFAULT_HOME_WAIT_SECONDS, help: 'Seconds to stay on the home page before visiting the target profile' },
    ],
    columns: ['id', 'title', 'type', 'likes', 'url'],
    func: async (page, kwargs) => {
        const userId = normalizeXhsUserId(String(kwargs.id));
        const limit = Math.max(1, Number(kwargs.limit ?? 15));
        const homeUrl = normalizeXhsHomeUrl(kwargs['home-url']);
        const homeWaitSeconds = toNonNegativeNumber(kwargs['home-wait-seconds'], DEFAULT_HOME_WAIT_SECONDS);
        await page.goto(homeUrl);
        if (homeWaitSeconds > 0) {
            await page.wait({ time: homeWaitSeconds });
        }
        await page.goto(`https://www.xiaohongshu.com/user/profile/${userId}`);
        let snapshot = await readUserSnapshot(page);
        let results = extractXhsUserNotes(snapshot ?? {}, userId);
        let previousCount = results.length;
        for (let i = 0; results.length < limit && i < 4; i += 1) {
            await page.autoScroll({ times: 1, delayMs: 1500 });
            await page.wait(1);
            snapshot = await readUserSnapshot(page);
            const nextResults = extractXhsUserNotes(snapshot ?? {}, userId);
            if (nextResults.length <= previousCount)
                break;
            results = nextResults;
            previousCount = nextResults.length;
        }
        if (results.length === 0) {
            throw new Error('No public notes found for this Xiaohongshu user.');
        }
        const dwellSeconds = Math.max(0, Number(process.env.OPENCLI_XHS_USER_DWELL_SECONDS ?? 8));
        const dwellJitterSeconds = Math.max(0, Number(process.env.OPENCLI_XHS_USER_DWELL_JITTER_SECONDS ?? 4));
        if (Number.isFinite(dwellSeconds) && dwellSeconds > 0) {
            const jitter = Number.isFinite(dwellJitterSeconds) && dwellJitterSeconds > 0
                ? Math.random() * dwellJitterSeconds
                : 0;
            await page.wait({ time: dwellSeconds + jitter });
        }
        return results.slice(0, limit);
    },
});
