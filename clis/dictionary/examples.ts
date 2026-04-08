import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: 'dictionary',
  name: 'examples',
  description: 'Read real-world example sentences utilizing the word',
  domain: 'api.dictionaryapi.dev',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    {
      name: 'word',
      type: 'string',
      required: true,
      positional: true,
      help: 'Word to get example sentences for',
    },
  ],
  columns: ['word', 'example'],
  pipeline: [
    { fetch: { url: 'https://api.dictionaryapi.dev/api/v2/entries/en/${{ args.word | urlencode }}' } },
    { map: {
        word: '${{ item.word }}',
        example: `\${{ (() => { if (item.meanings) { for (const m of item.meanings) { if (m.definitions) { for (const d of m.definitions) { if (d.example) return d.example; } } } } return 'No example found in API.'; })() }}`,
      } },
    { limit: 1 },
  ],
});
