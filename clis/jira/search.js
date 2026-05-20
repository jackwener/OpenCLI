import { cli, Strategy } from '@jackwener/opencli/registry';
import { jiraConfig, issueSummaryRow, jiraRowsOrEmpty, parseJiraLimit } from './shared.js';
import { atlassianRequest, requirePayloadArray, requirePayloadObject, requireString } from '../_atlassian/shared.js';

function searchPath(config) {
    return config.deployment === 'cloud' ? '/rest/api/3/search/jql' : '/rest/api/2/search';
}

function searchPayload(config, jql, limit) {
    const fields = ['summary', 'issuetype', 'status', 'priority', 'assignee', 'updated'];
    if (config.deployment === 'cloud') return { jql, maxResults: limit, fields };
    return { jql, startAt: 0, maxResults: limit, fields };
}

cli({
    site: 'jira',
    name: 'search',
    access: 'read',
    description: 'Search Jira issues with JQL',
    domain: 'atlassian.net',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'jql', positional: true, required: true, help: 'JQL query, e.g. "project = PROJ order by updated desc"' },
        { name: 'limit', type: 'int', default: 20, help: 'Max issues to return (1-100)' },
    ],
    columns: ['key', 'summary', 'issueType', 'status', 'priority', 'assignee', 'updated', 'url'],
    func: async (args) => {
        const config = jiraConfig();
        const jql = requireString(args.jql, 'JQL');
        const limit = parseJiraLimit(args.limit, 20, 100);
        const data = await atlassianRequest(config, searchPath(config), {
            method: 'POST',
            body: searchPayload(config, jql, limit),
            label: 'jira search',
        });
        const payload = requirePayloadObject(data, 'jira search');
        const issues = requirePayloadArray(payload.issues, 'jira search issues');
        return jiraRowsOrEmpty(
            issues.map((issue) => issueSummaryRow(issue, config)),
            'jira search',
            `No Jira issues matched "${jql}".`,
        );
    },
});

export const __test__ = { searchPath, searchPayload };
