// wikipedia page — full article extract (plain text) with optional paragraph cap.
//
// Unlike `wikipedia summary` which returns the lead-section blurb truncated to
// 300 chars, this adapter returns the *complete* article body (or the first N
// paragraphs by explicit opt-in). No silent truncation: the caller decides.
import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    ArgumentError,
    CommandExecutionError,
    EmptyResultError,
} from '@jackwener/opencli/errors';

cli({
    site: 'wikipedia',
    name: 'page',
    access: 'read',
    description: 'Full plain-text extract of a Wikipedia article (optional paragraph cap).',
    domain: 'wikipedia.org',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'title', positional: true, required: true, type: 'string', help: 'Article title (e.g. "Transformer (machine learning model)")' },
        { name: 'lang', type: 'string', default: 'en', help: 'Language code (en, zh, ja, de, ...).' },
        { name: 'paragraphs', type: 'int', default: 0, help: 'Cap to first N paragraphs (0 = full article).' },
    ],
    columns: ['title', 'description', 'pageId', 'paragraphs', 'extract', 'url'],
    func: async (args) => {
        const title = String(args.title ?? '').trim();
        if (!title) {
            throw new ArgumentError('wikipedia page title cannot be empty');
        }
        const lang = String(args.lang ?? 'en').trim().toLowerCase();
        if (!/^[a-z]{2,3}(?:-[a-z0-9]+)?$/.test(lang)) {
            throw new ArgumentError(`wikipedia lang must be a language code like en, zh, ja (got "${args.lang}")`);
        }
        const paragraphsCap = Number(args.paragraphs ?? 0);
        if (!Number.isInteger(paragraphsCap) || paragraphsCap < 0) {
            throw new ArgumentError('paragraphs must be a non-negative integer (0 = full article)');
        }

        const url = new URL(`https://${lang}.wikipedia.org/w/api.php`);
        url.searchParams.set('action', 'query');
        url.searchParams.set('format', 'json');
        url.searchParams.set('formatversion', '2');
        url.searchParams.set('prop', 'extracts|info|description');
        url.searchParams.set('inprop', 'url');
        url.searchParams.set('explaintext', '1');
        url.searchParams.set('redirects', '1');
        url.searchParams.set('titles', title);

        let resp;
        try {
            resp = await fetch(url, {
                headers: {
                    'User-Agent': 'opencli/1.0 (+https://github.com/jackwener/opencli)',
                    'Accept': 'application/json',
                },
            });
        } catch (error) {
            throw new CommandExecutionError(`wikipedia page request failed: ${error?.message || error}`);
        }
        if (!resp.ok) {
            throw new CommandExecutionError(`wikipedia page failed: HTTP ${resp.status}`);
        }
        let data;
        try {
            data = await resp.json();
        } catch (error) {
            throw new CommandExecutionError(`wikipedia returned malformed JSON: ${error?.message || error}`);
        }
        if (data?.error) {
            throw new CommandExecutionError(`wikipedia API error: ${data.error.info || data.error.code}`);
        }
        const pages = Array.isArray(data?.query?.pages) ? data.query.pages : [];
        const page = pages[0];
        if (!page || page.missing) {
            throw new EmptyResultError('wikipedia page', `No article "${title}" on ${lang}.wikipedia.org. Try \`opencli wikipedia search\` first.`);
        }
        const fullExtract = String(page.extract ?? '');
        if (!fullExtract.trim()) {
            throw new EmptyResultError('wikipedia page', `Article "${page.title}" exists but has no plain-text extract (likely a disambiguation/redirect page).`);
        }
        const allParas = fullExtract.split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
        const paras = paragraphsCap > 0 ? allParas.slice(0, paragraphsCap) : allParas;

        return [{
            title: page.title,
            description: page.description || '',
            pageId: page.pageid ?? null,
            paragraphs: paras.length,
            extract: paras.join('\n\n'),
            url: page.fullurl || `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`,
        }];
    },
});
