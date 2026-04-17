import { cli, Strategy } from '@jackwener/opencli/registry';
cli({
    site: 'dictionary',
    name: 'synonyms',
    description: 'Find synonyms for a specific word',
    domain: 'api.dictionaryapi.dev',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        {
            name: 'word',
            type: 'string',
            required: true,
            positional: true,
            help: 'Word to find synonyms for (e.g., serendipity)',
        },
    ],
    columns: ['word', 'synonyms'],
    pipeline: [
        { fetch: { url: 'https://api.dictionaryapi.dev/api/v2/entries/en/${{ args.word | urlencode }}' } },
        { map: {
                word: '${{ item.word }}',
                synonyms: `\${{ (() => { const s = new Set(); if (item.meanings) { for (const m of item.meanings) { if (m.synonyms) { for (const syn of m.synonyms) s.add(syn); } if (m.definitions) { for (const d of m.definitions) { if (d.synonyms) { for (const syn of d.synonyms) s.add(syn); } } } } } const arr = Array.from(s); return arr.length > 0 ? arr.slice(0, 5).join(', ') : 'No synonyms found in API.'; })() }}`,
            } },
        { limit: 1 },
    ],
});
