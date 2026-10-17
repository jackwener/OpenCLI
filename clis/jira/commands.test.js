import { describe, expect, it, afterEach, vi } from 'vitest';

import { __test__ as jiraSharedTest } from './shared.js';

const ENV_KEYS = [
    'ATLASSIAN_JIRA_BASE_URL',
    'ATLASSIAN_DEPLOYMENT',
    'ATLASSIAN_EMAIL',
    'ATLASSIAN_API_TOKEN',
    'ATLASSIAN_USERNAME',
    'ATLASSIAN_PASSWORD',
    'ATLASSIAN_PAT',
    'ATLASSIAN_JIRA_ACCEPTANCE_FIELD',
    'ATLASSIAN_JIRA_SPRINT_FIELD',
    'ATLASSIAN_JIRA_STORY_POINTS_FIELD',
];

function clearEnv() {
    for (const key of ENV_KEYS) delete process.env[key];
}

function setCloudEnv() {
    clearEnv();
    process.env.ATLASSIAN_JIRA_BASE_URL = 'https://team.atlassian.net';
    process.env.ATLASSIAN_DEPLOYMENT = 'cloud';
    process.env.ATLASSIAN_EMAIL = 'bot@example.com';
    process.env.ATLASSIAN_API_TOKEN = 'secret';
}

function jsonResponse(body) {
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

afterEach(() => {
    clearEnv();
    vi.unstubAllGlobals();
});

describe('jira commands', () => {
    it('unions internal transport fields without exposing them as selected fields', async () => {
        setCloudEnv();
        const selection = jiraSharedTest.parseIssueFieldSelection('summary');
        const fetchMock = vi.fn(async (url) => {
            const parsed = new URL(String(url));
            expect(parsed.searchParams.get('fields')).toBe('summary,attachment');
            return jsonResponse({ key: 'PROJ-1', fields: { summary: 'Task', attachment: [] }, names: {} });
        });
        vi.stubGlobal('fetch', fetchMock);
        const config = {
            baseUrl: 'https://team.atlassian.net',
            deployment: 'cloud',
            product: 'jira',
            authHeaders: {},
        };
        const issue = await jiraSharedTest.fetchIssue(config, 'PROJ-1', ['attachment'], selection);
        const row = jiraSharedTest.normalizeJiraIssue(issue, config, {
            selection,
            requireNestedCollections: false,
        });
        expect(row.selectedFields).toEqual([{ id: 'summary', name: 'summary', value: 'Task' }]);
        expect(fetchMock).toHaveBeenCalledOnce();
    });

});
