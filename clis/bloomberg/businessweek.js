import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';

const SECTION_URL = 'https://www.bloomberg.com/businessweek';

// Bloomberg now serves the Businessweek RSS feed empty (feeds.bloomberg.com/businessweek/news.rss
// returns a maintained-but-item-less channel), while the Businessweek section page keeps
// publishing. Like `bloomberg news`, the page ships its data as Next.js __NEXT_DATA__; the
// section's stories live under props.pageProps.initialState.modulesById[*].items[]. So we read
// the section page in the browser and pull the story list out of the embedded SSR state.
cli({
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
        await page.goto(SECTION_URL);
        await page.wait({ selector: '#__NEXT_DATA__', timeout: 8 });
        const loadStories = async () => page.evaluate(`(() => {
      const el = document.getElementById('__NEXT_DATA__');
      if (!el) return { errorCode: 'NO_NEXT_DATA', title: document.title };
      let data;
      try { data = JSON.parse(el.textContent); }
      catch (err) { return { errorCode: 'BAD_NEXT_DATA', message: String(err) }; }
      const modules = data && data.props && data.props.pageProps
        && data.props.pageProps.initialState && data.props.pageProps.initialState.modulesById;
      if (!modules || typeof modules !== 'object') return { errorCode: 'NO_MODULES' };
      const seen = new Set();
      const stories = [];
      for (const mod of Object.values(modules)) {
        const items = mod && Array.isArray(mod.items) ? mod.items : [];
        for (const it of items) {
          const headline = it && typeof it.headline === 'string' ? it.headline.trim() : '';
          const path = it && typeof it.url === 'string' ? it.url : '';
          if (!headline || path.indexOf('/news/') !== 0) continue;
          const key = path.split('?')[0];
          if (seen.has(key)) continue;
          seen.add(key);
          const summary = (it.summary && String(it.summary).trim())
            || (it.eyebrow && it.eyebrow.text ? String(it.eyebrow.text).trim() : '');
          const img = (it.image && (it.image.baseUrl || it.image.url))
            || (it.lede && (it.lede.baseUrl || it.lede.url)) || '';
          stories.push({
            title: headline,
            summary,
            link: path.indexOf('http') === 0 ? path : 'https://www.bloomberg.com' + path,
            mediaLinks: img ? [img] : [],
          });
        }
      }
      return { stories };
    })()`);
        let result = await loadStories();
        // Next.js sometimes hydrates slowly — retry once before giving up.
        if (result && (result.errorCode === 'NO_NEXT_DATA' || result.errorCode === 'NO_MODULES')) {
            await page.wait(4);
            result = await loadStories();
        }
        if (result && result.errorCode) {
            throw new CliError('PARSE_ERROR', `Bloomberg Businessweek page did not expose story data (${result.errorCode})`, 'Bloomberg may have changed the page structure.');
        }
        const stories = (result && result.stories) || [];
        if (!stories.length) {
            throw new CliError('NOT_FOUND', 'No Bloomberg Businessweek stories found', 'Bloomberg may have changed the page structure.');
        }
        const count = Math.max(1, Math.min(Number(kwargs.limit) || 1, 20));
        return stories.slice(0, count);
    },
});
