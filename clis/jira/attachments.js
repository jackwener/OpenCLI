import { cli, Strategy } from '@jackwener/opencli/registry';
import { fetchIssue, jiraConfig, normalizeAttachment, requireIssueKey } from './shared.js';

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
        const attachments = Array.isArray(issue?.fields?.attachment) ? issue.fields.attachment : [];
        return attachments.map(normalizeAttachment);
    },
});
