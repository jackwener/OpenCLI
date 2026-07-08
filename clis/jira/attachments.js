import { cli, Strategy } from '@jackwener/opencli/registry';
import { fetchIssue, jiraConfig, jiraRowsOrEmpty, normalizeAttachment, requireIssueKey } from './shared.js';
import { requirePayloadArray } from '../_atlassian/shared.js';

cli({
    site: 'jira',
    name: 'attachments',
    access: 'read',
    description: 'Jira issue attachment metadata',
    domain: 'atlassian.net',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'key', positional: true, required: true, help: 'Jira issue key, e.g. PROJ-123' },
    ],
    columns: ['id', 'filename', 'mimeType', 'size', 'url'],
    func: async (args) => {
        const key = requireIssueKey(args.key);
        const config = jiraConfig();
        const issue = await fetchIssue(config, key, ['attachment']);
        const attachments = requirePayloadArray(issue.fields?.attachment, `jira attachments ${key}`);
        return jiraRowsOrEmpty(
            attachments.map(normalizeAttachment),
            `jira attachments ${key}`,
            `Jira issue ${key} has no attachments.`,
        );
    },
});
