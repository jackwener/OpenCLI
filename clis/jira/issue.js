import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    fetchComments,
    fetchIssue,
    issueSelectionIncludes,
    jiraConfig,
    normalizeJiraIssue,
    parseIssueFieldSelection,
    parseJiraLimit,
    requireIssueKey,
} from './shared.js';

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
        const selection = parseIssueFieldSelection(args.fields);
        const commentsLimit = parseJiraLimit(args['comments-limit'], 100, 100);
        const config = jiraConfig();
        const issue = await fetchIssue(config, key, [], selection);
        let comments;
        if (issueSelectionIncludes(selection, 'comment')) {
            const inlineComments = issue?.fields?.comment?.comments;
            const total = Number(issue?.fields?.comment?.total ?? inlineComments?.length ?? 0);
            comments = total > (inlineComments?.length ?? 0)
                ? await fetchComments(config, key, commentsLimit)
                : inlineComments;
        }
        return [normalizeJiraIssue(issue, config, { comments, selection })];
    },
});
