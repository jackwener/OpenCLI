import { cli, Strategy } from '@jackwener/opencli/registry';
import { atlassianRequest, requireExecute, requirePayloadObject, requireString } from '../_atlassian/shared.js';
import { confluenceConfig, getPage, normalizeConfluencePage, readPageBodyFile, updatePagePayload } from './shared.js';

cli({
    site: 'confluence',
    name: 'update',
    access: 'write',
    description: 'Update a Confluence page body from Markdown or storage XHTML',
    domain: 'atlassian.net',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'id', positional: true, required: true, help: 'Confluence page id' },
        { name: 'file', type: 'string', required: true, help: 'Markdown file path' },
        { name: 'title', type: 'string', help: 'Optional replacement title; defaults to current title' },
        { name: 'version-message', type: 'string', help: 'Confluence version message' },
        { name: 'representation', type: 'string', default: 'markdown', choices: ['markdown', 'storage'], help: 'Input file format' },
        { name: 'execute', type: 'boolean', help: 'Actually update the remote page' },
    ],
    columns: ['status', 'id', 'title', 'spaceId', 'spaceKey', 'version', 'url'],
    func: async (args) => {
        requireExecute(args, 'confluence update');
        const config = confluenceConfig();
        const id = requireString(args.id, 'Confluence page id');
        const current = await getPage(config, id);
        const storage = await readPageBodyFile(args);
        const payload = updatePagePayload(config, current, args, storage);
        const path = config.deployment === 'cloud' ? `/api/v2/pages/${encodeURIComponent(id)}` : `/rest/api/content/${encodeURIComponent(id)}`;
        const page = requirePayloadObject(await atlassianRequest(config, path, {
            method: 'PUT',
            body: payload,
            label: `confluence update ${id}`,
        }), `confluence update ${id}`);
        const normalized = normalizeConfluencePage(page, config);
        return [{ ...normalized, pageStatus: normalized.status, status: 'updated' }];
    },
});
