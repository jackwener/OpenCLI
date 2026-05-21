import { cli, Strategy } from '@jackwener/opencli/registry';
import { fetchComments, jiraConfig, jiraRowsOrEmpty, normalizeComment, parseJiraLimit, requireIssueKey } from './shared.js';

cli({
    site: 'jira',
    name: 'comments',
    access: 'read',
    description: 'Jira issue comments as Markdown',
    domain: 'atlassian.net',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'key', positional: true, required: true, help: 'Jira issue key, e.g. PROJ-123' },
        { name: 'limit', type: 'int', default: 50, help: 'Max comments to return (1-100)' },
    ],
    columns: ['id', 'author', 'created', 'updated', 'markdown'],
    func: async (args) => {
        const key = requireIssueKey(args.key);
        const config = jiraConfig();
        const limit = parseJiraLimit(args.limit, 50, 100);
        const comments = await fetchComments(config, key, limit);
        return jiraRowsOrEmpty(
            comments.map(normalizeComment),
            `jira comments ${key}`,
            `Jira issue ${key} has no comments.`,
        );
    },
});
