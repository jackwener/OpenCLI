import { cli, Strategy } from '@jackwener/opencli/registry';
import { fetchIssue, jiraConfig, normalizeIssueLink, requireIssueKey } from './shared.js';

cli({
    site: 'jira',
    name: 'links',
    access: 'read',
    description: 'Jira issue links',
    domain: 'atlassian.net',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'key', positional: true, required: true, help: 'Jira issue key, e.g. PROJ-123' },
    ],
    columns: ['key', 'type', 'direction'],
    func: async (args) => {
        const key = requireIssueKey(args.key);
        const config = jiraConfig();
        const issue = await fetchIssue(config, key, ['issuelinks']);
        const links = Array.isArray(issue?.fields?.issuelinks) ? issue.fields.issuelinks : [];
        return links.map(normalizeIssueLink).filter((link) => link.key);
    },
});
