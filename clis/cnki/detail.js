import { cli, Strategy } from '@jackwener/opencli/registry';
import { extractCnkiDetail, normalizeCnkiUrl } from './shared.js';

cli({
  site: 'cnki',
  name: 'detail',
  description: 'CNKI paper detail metadata and abstract extraction',
  access: 'read',
  domain: 'kns.cnki.net',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'url', positional: true, required: true, help: 'CNKI detail page URL' },
  ],
  columns: ['title', 'authors', 'journal', 'source', 'date', 'year', 'volume', 'issue', 'pages', 'startPage', 'endPage', 'doi', 'classification', 'album', 'subject', 'fund', 'onlinePublishedAt', 'cnkiId', 'abstract', 'keywords', 'url'],
  navigateBefore: false,
  func: async (page, kwargs) => {
    const url = normalizeCnkiUrl(kwargs.url);
    const detail = await extractCnkiDetail(page, url);
    return {
      ...detail,
      keywords: detail.keywords.join(', '),
    };
  },
});


