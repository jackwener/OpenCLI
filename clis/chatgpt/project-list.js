import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    CHATGPT_DOMAIN,
    ensureChatGPTLogin,
    getProjectList,
    requirePositiveInt,
} from './utils.js';

export const projectListCommand = cli({
    site: 'chatgpt',
    name: 'project-list',
    access: 'read',
    description: 'List visible ChatGPT projects from the sidebar',
    domain: CHATGPT_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Max projects to show' },
    ],
    columns: ['Index', 'Id', 'Title', 'Url'],
    func: async (page, kwargs) => {
        const limit = requirePositiveInt(
            Number(kwargs.limit ?? 20),
            'chatgpt project-list --limit',
            'Example: opencli chatgpt project-list --limit 20',
        );
        await ensureChatGPTLogin(page, 'ChatGPT project-list requires a logged-in ChatGPT session.');
        const projects = await getProjectList(page);
        if (!projects.length) {
            throw new EmptyResultError('chatgpt project-list', 'No ChatGPT project links were visible in the sidebar.');
        }
        return projects.slice(0, limit);
    },
});
