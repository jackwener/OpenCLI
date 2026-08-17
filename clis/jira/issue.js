import { cli, Strategy } from '@jackwener/opencli/registry';
import { fetchComments, fetchIssue, jiraConfig, normalizeJiraIssue, requireIssueKey } from './shared.js';

cli({
    site: 'jira',
    name: 'issue',
    access: 'read',
    description: 'Jira issue detail normalized for agents (description, comments, attachments, links)',
    domain: 'atlassian.net',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'key', positional: true, required: true, help: 'Jira issue key, e.g. PROJ-123' },
        { name: 'comments-limit', type: 'int', default: 100, help: 'Max comments to include (1-100)' },
        { name: 'fields', type: 'string', help: 'Fields to request, comma-separated, or auto for all fields' },
    ],
    columns: ['key', 'summary', 'issueType', 'status', 'priority', 'assignee', 'updated', 'url'],
    func: async (args) => {
        const key = requireIssueKey(args.key);
        const config = jiraConfig();
        const issue = await fetchIssue(config, key, [], args.fields);
        const inlineComments = issue?.fields?.comment?.comments;
        const total = Number(issue?.fields?.comment?.total ?? inlineComments?.length ?? 0);
        const comments = total > (inlineComments?.length ?? 0)
            ? await fetchComments(config, key, args['comments-limit'])
            : inlineComments;
        return [normalizeJiraIssue(issue, config, { comments, fields: args.fields })];
    },
});
