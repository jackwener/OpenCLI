import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CliError } from '@jackwener/opencli/errors';

const SECTION_URL = 'https://www.bloomberg.com/businessweek';

export function parseBusinessweekLimit(value) {
    const limit = value == null || value === '' ? 1 : Number(value);
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
        throw new ArgumentError('bloomberg businessweek --limit must be an integer between 1 and 20', 'Example: opencli bloomberg businessweek --limit 5');
    }
    return limit;
}

export function normalizeBusinessweekStoryPath(path) {
    const raw = typeof path === 'string' ? path.trim() : '';
    if (!raw)
        return '';
    let url;
    try {
        url = new URL(raw, 'https://www.bloomberg.com');
    }
    catch {
        return '';
    }
    if (url.protocol !== 'https:' || url.hostname !== 'www.bloomberg.com')
        return '';
    if (!/^\/(?:news|features)\//.test(url.pathname))
        return '';
    return `${url.pathname}${url.search}`;
}

export function extractBusinessweekStoriesFromNextData(data) {
    const modules = data && data.props && data.props.pageProps
        && data.props.pageProps.initialState && data.props.pageProps.initialState.modulesById;
    if (!modules || typeof modules !== 'object')
        return null;
    const seen = new Set();
    const stories = [];
    for (const mod of Object.values(modules)) {
        const items = mod && Array.isArray(mod.items) ? mod.items : [];
        for (const it of items) {
            const headline = it && typeof it.headline === 'string' ? it.headline.trim() : '';
            const storyPath = normalizeBusinessweekStoryPath(it && typeof it.url === 'string' ? it.url : '');
            if (!headline || !storyPath)
                continue;
            const key = storyPath.split('?')[0];
            if (seen.has(key))
                continue;
            seen.add(key);
            const summary = (it.summary && String(it.summary).trim())
                || (it.eyebrow && it.eyebrow.text ? String(it.eyebrow.text).trim() : '');
            const img = (it.image && (it.image.baseUrl || it.image.url))
                || (it.lede && (it.lede.baseUrl || it.lede.url)) || '';
            stories.push({
                title: headline,
                summary,
                link: `https://www.bloomberg.com${storyPath}`,
                mediaLinks: img ? [img] : [],
            });
        }
    }
    return stories;
}

// Bloomberg now serves the Businessweek RSS feed empty (feeds.bloomberg.com/businessweek/news.rss
// returns a maintained-but-item-less channel), while the Businessweek section page keeps
// publishing. Like `bloomberg news`, the page ships its data as Next.js __NEXT_DATA__; the
// section's stories live under props.pageProps.initialState.modulesById[*].items[]. So we read
// the section page in the browser and pull the story list out of the embedded SSR state.
export const command = cli({
    site: 'bloomberg',
    name: 'businessweek',
    access: 'read',
    description: 'Bloomberg Businessweek top stories',
    domain: 'www.bloomberg.com',
    strategy: Strategy.PUBLIC,
    browser: true,
    args: [
        { name: 'limit', type: 'int', default: 1, help: 'Number of stories to return (max 20)' },
    ],
    columns: ['title', 'summary', 'link', 'mediaLinks'],
    func: async (page, kwargs) => {
        const count = parseBusinessweekLimit(kwargs.limit);
        await page.goto(SECTION_URL);
        await page.wait({ selector: '#__NEXT_DATA__', timeout: 8 });
        const normalizeStoryPathSource = normalizeBusinessweekStoryPath.toString();
        const extractStoriesSource = extractBusinessweekStoriesFromNextData.toString();
        const loadStories = async () => page.evaluate(`(() => {
      ${normalizeStoryPathSource}
      ${extractStoriesSource}
      const el = document.getElementById('__NEXT_DATA__');
      if (!el) return { ok: false, error: 'NO_NEXT_DATA', title: document.title };
      let data;
      try { data = JSON.parse(el.textContent); }
      catch (err) { return { ok: false, error: 'BAD_NEXT_DATA', message: String(err) }; }
      const stories = extractBusinessweekStoriesFromNextData(data);
      if (!stories) return { ok: false, error: 'NO_MODULES' };
      return { ok: true, stories };
    })()`);
        let result = await loadStories();
        // Next.js sometimes hydrates slowly — retry once before giving up.
        if (result && result.ok === false && (result.error === 'NO_NEXT_DATA' || result.error === 'NO_MODULES')) {
            await page.wait(4);
            result = await loadStories();
        }
        if (!result || typeof result !== 'object') {
            throw new CliError('PARSE_ERROR', 'Bloomberg Businessweek page returned malformed story data', 'Bloomberg may have changed the page structure.');
        }
        if (result.ok === false) {
            throw new CliError('PARSE_ERROR', `Bloomberg Businessweek page did not expose story data (${result.error})`, 'Bloomberg may have changed the page structure.');
        }
        const stories = Array.isArray(result.stories) ? result.stories : [];
        if (!stories.length) {
            throw new CliError('NOT_FOUND', 'No Bloomberg Businessweek stories found', 'Bloomberg may have changed the page structure.');
        }
        return stories.slice(0, count);
    },
});

export const __test__ = {
    command,
    parseBusinessweekLimit,
    normalizeBusinessweekStoryPath,
    extractBusinessweekStoriesFromNextData,
};
