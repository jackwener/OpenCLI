import { cli, Strategy } from '@jackwener/opencli/registry';
import { requireString } from '../_atlassian/shared.js';
import { confluenceConfig, getPage, normalizeConfluencePage } from './shared.js';

cli({
    site: 'confluence',
    name: 'page',
    access: 'read',
    description: 'Confluence page by id with storage and Markdown body',
    domain: 'atlassian.net',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'id', positional: true, required: true, help: 'Confluence page id' },
    ],
    columns: ['id', 'title', 'status', 'spaceId', 'spaceKey', 'version', 'url'],
    func: async (args) => {
        const config = confluenceConfig();
        const id = requireString(args.id, 'Confluence page id');
        const page = await getPage(config, id);
        return [normalizeConfluencePage(page, config)];
    },
});
