import { cli, Strategy } from '@jackwener/opencli/registry';
cli({
    site: 'dictionary',
    name: 'search',
    access: 'read',
    description: 'Search the Free Dictionary API for definitions, parts of speech, and pronunciations.',
    domain: 'api.dictionaryapi.dev',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        {
            name: 'word',
            type: 'string',
            required: true,
            positional: true,
            help: 'Word to define (e.g., serendipity)',
        },
    ],
    columns: ['word', 'phonetic', 'type', 'definition'],
    pipeline: [
        { fetch: { url: 'https://api.dictionaryapi.dev/api/v2/entries/en/${{ args.word | urlencode }}' } },
        { map: {
                word: '${{ item.word }}',
                phonetic: `\${{ (() => { if (item.phonetic) return item.phonetic; if (item.phonetics) { for (const p of item.phonetics) { if (p.text) return p.text; } } return ''; })() }}`,
                type: `\${{ (() => { if (item.meanings && item.meanings[0] && item.meanings[0].partOfSpeech) return item.meanings[0].partOfSpeech; return 'N/A'; })() }}`,
                definition: `\${{ (() => { if (item.meanings && item.meanings[0] && item.meanings[0].definitions && item.meanings[0].definitions[0] && item.meanings[0].definitions[0].definition) return item.meanings[0].definitions[0].definition; return 'No definition found in API.'; })() }}`,
            } },
        { limit: 1 },
    ],
});
