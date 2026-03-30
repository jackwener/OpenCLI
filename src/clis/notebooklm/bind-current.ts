import { cli, Strategy } from '../../registry.js';
import { bindCurrentTab } from '../../browser/daemon-client.js';
import { NOTEBOOKLM_DOMAIN, NOTEBOOKLM_SITE } from './shared.js';
import { parseNotebooklmIdFromUrl } from './utils.js';

cli({
  site: NOTEBOOKLM_SITE,
  name: 'bind-current',
  aliases: ['use'],
  description: 'Bind the current active NotebookLM notebook tab into the site:notebooklm workspace',
  domain: NOTEBOOKLM_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [],
  columns: ['workspace', 'tab_id', 'notebook_id', 'title', 'url'],
  func: async () => {
    const result = await bindCurrentTab(`site:${NOTEBOOKLM_SITE}`, {
      matchDomain: NOTEBOOKLM_DOMAIN,
      matchPathPrefix: '/notebook/',
    }) as {
      tabId?: number;
      workspace?: string;
      title?: string;
      url?: string;
    };

    return [{
      workspace: result.workspace ?? `site:${NOTEBOOKLM_SITE}`,
      tab_id: result.tabId ?? null,
      notebook_id: result.url ? parseNotebooklmIdFromUrl(result.url) : '',
      title: result.title ?? '',
      url: result.url ?? '',
    }];
  },
});
