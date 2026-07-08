import { cli, Strategy } from '@jackwener/opencli/registry';
import { requireExecute, requirePayloadObject, requireString } from '../_atlassian/shared.js';
import { confluenceConfig, createPagePayload, normalizeConfluencePage, readPageBodyFile } from './shared.js';
import { atlassianRequest } from '../_atlassian/shared.js';

cli({
    site: 'confluence',
    name: 'create',
    access: 'write',
    description: 'Create a Confluence page from Markdown or storage XHTML',
    domain: 'atlassian.net',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'space', type: 'string', required: true, help: 'Cloud space id, or Data Center space key' },
        { name: 'title', type: 'string', required: true, help: 'Page title' },
        { name: 'file', type: 'string', required: true, help: 'Markdown file path' },
        { name: 'parent', type: 'string', help: 'Optional parent page id' },
        { name: 'representation', type: 'string', default: 'markdown', choices: ['markdown', 'storage'], help: 'Input file format' },
        { name: 'execute', type: 'boolean', help: 'Actually create the remote page' },
    ],
    columns: ['status', 'id', 'title', 'spaceId', 'spaceKey', 'version', 'url'],
    func: async (args) => {
        requireExecute(args, 'confluence create');
        requireString(args.space, 'Confluence space');
        requireString(args.title, 'Confluence page title');
        const storage = await readPageBodyFile(args);
        const config = confluenceConfig();
        const payload = createPagePayload(config, args, storage);
        const path = config.deployment === 'cloud' ? '/api/v2/pages' : '/rest/api/content';
        const page = requirePayloadObject(await atlassianRequest(config, path, {
            method: 'POST',
            body: payload,
            label: 'confluence create',
        }), 'confluence create');
        const normalized = normalizeConfluencePage(page, config);
        return [{ ...normalized, pageStatus: normalized.status, status: 'created' }];
    },
});
