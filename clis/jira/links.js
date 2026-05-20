import { cli, Strategy } from '@jackwener/opencli/registry';
import { fetchIssue, jiraConfig, jiraRowsOrEmpty, normalizeIssueLink, requireIssueKey } from './shared.js';
import { requirePayloadArray } from '../_atlassian/shared.js';

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
        const links = requirePayloadArray(issue.fields?.issuelinks, `jira links ${key}`);
        return jiraRowsOrEmpty(
            links.map(normalizeIssueLink),
            `jira links ${key}`,
            `Jira issue ${key} has no linked issues.`,
        );
    },
});
