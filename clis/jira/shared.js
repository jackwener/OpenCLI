import {
    adfToMarkdown,
    atlassianRequest,
    getJiraConfig,
    htmlToMarkdown,
    parseLimit,
    queryString,
    requireNonEmptyRows,
    requirePayloadArray,
    requirePayloadObject,
    requirePayloadString,
    requireString,
} from '../_atlassian/shared.js';
import { ArgumentError, ConfigError } from '@jackwener/opencli/errors';

const DEFAULT_ISSUE_FIELDS = [
    'summary',
    'issuetype',
    'status',
    'priority',
    'labels',
    'description',
    'comment',
    'attachment',
    'issuelinks',
    'fixVersions',
    'versions',
    'components',
    'project',
    'reporter',
    'assignee',
    'created',
    'updated',
];

function jiraApiPrefix(config) {
    return `/rest/api/${config.deployment === 'cloud' ? '3' : '2'}`;
}

export function jiraApiPath(config, resource, params) {
    return `${jiraApiPrefix(config)}${resource.startsWith('/') ? resource : `/${resource}`}${params ? queryString(params) : ''}`;
}

export async function jiraRequest(config, resource, options = {}) {
    return atlassianRequest(config, jiraApiPath(config, resource, options.params), options);
}

function configuredFieldNames() {
    return {
        acceptanceCriteria: process.env.ATLASSIAN_JIRA_ACCEPTANCE_FIELD?.trim() || '',
        sprint: process.env.ATLASSIAN_JIRA_SPRINT_FIELD?.trim() || '',
        storyPoints: process.env.ATLASSIAN_JIRA_STORY_POINTS_FIELD?.trim() || '',
    };
}

function configuredIssueFields() {
    const raw = process.env.ATLASSIAN_JIRA_FIELDS;
    if (raw === undefined) return null;
    if (raw.trim().toLowerCase() === 'auto') return 'auto';

    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new ConfigError(
            'Invalid ATLASSIAN_JIRA_FIELDS',
            'Set ATLASSIAN_JIRA_FIELDS to a JSON array of field names, for example ["summary","customfield_12345"].',
        );
    }
    if (!Array.isArray(parsed) || parsed.some((field) => typeof field !== 'string' || !field.trim())) {
        throw new ConfigError(
            'Invalid ATLASSIAN_JIRA_FIELDS',
            'Set ATLASSIAN_JIRA_FIELDS to a JSON array of non-empty strings.',
        );
    }
    return [...new Set(parsed.map((field) => field.trim()))];
}

function issueFields(extraFields = []) {
    const selected = configuredIssueFields();
    if (selected === 'auto') return undefined;
    if (selected !== null) return selected.join(',');
    const configured = Object.values(configuredFieldNames()).filter(Boolean);
    return [...new Set([...DEFAULT_ISSUE_FIELDS, ...configured, ...extraFields.filter(Boolean)])].join(',');
}

export function parseJiraLimit(value, fallback = 20, max = 100) {
    return parseLimit(value, fallback, max, 'jira limit');
}

export function requireIssueKey(value) {
    const key = requireString(value, 'Jira issue key');
    if (!/^[A-Za-z][A-Za-z0-9_]+-\d+$/.test(key)) {
        throw new ArgumentError(`Invalid Jira issue key: ${key}`, 'Expected a key like PROJECT-123.');
    }
    return key.toUpperCase();
}

function displayUser(user) {
    if (!user || typeof user !== 'object') return '';
    return String(user.displayName ?? user.name ?? user.emailAddress ?? user.accountId ?? '');
}

function valueName(value) {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'object') return String(value.name ?? value.value ?? value.key ?? value.id ?? '');
    return String(value);
}

function valueNames(values) {
    return Array.isArray(values) ? values.map(valueName).filter(Boolean) : [];
}

export function jiraBodyToMarkdown(raw, rendered) {
    if (rendered) return htmlToMarkdown(rendered);
    if (raw && typeof raw === 'object') return adfToMarkdown(raw);
    if (typeof raw === 'string') return raw.trim();
    return '';
}

export function normalizeComment(comment) {
    const row = requirePayloadObject(comment, 'jira comment');
    return {
        id: requirePayloadString(row.id, 'comment id', 'jira comment'),
        author: displayUser(row.author),
        created: row.created ? String(row.created) : '',
        updated: row.updated ? String(row.updated) : undefined,
        markdown: jiraBodyToMarkdown(row.body, row.renderedBody),
    };
}

export function normalizeAttachment(attachment) {
    const row = requirePayloadObject(attachment, 'jira attachment');
    return {
        id: requirePayloadString(row.id, 'attachment id', 'jira attachment'),
        filename: requirePayloadString(row.filename, 'filename', 'jira attachment'),
        mimeType: row.mimeType ? String(row.mimeType) : undefined,
        size: row.size != null ? Number(row.size) : undefined,
        url: requirePayloadString(row.content ?? row.self, 'attachment url', 'jira attachment'),
    };
}

export function normalizeIssueLink(link) {
    const row = requirePayloadObject(link, 'jira issue link');
    const outward = row.outwardIssue;
    const inward = row.inwardIssue;
    const issue = outward ?? inward ?? {};
    const key = requirePayloadString(issue.key, 'linked issue key', 'jira issue link');
    return {
        key,
        type: String(row.type?.name ?? (outward ? row.type?.outward : row.type?.inward) ?? ''),
        direction: outward ? 'outward' : 'inward',
    };
}

function customValueToMarkdown(value) {
    if (!value) return '';
    if (typeof value === 'string') return value.trim();
    if (value && typeof value === 'object' && value.type === 'doc') return adfToMarkdown(value);
    if (Array.isArray(value)) return value.map(valueName).filter(Boolean).join(', ');
    return valueName(value);
}

function autoFields(fields, names) {
    const result = {};
    for (const [field, value] of Object.entries(fields)) {
        if (value === null) continue;
        const name = field.startsWith('customfield_')
            && typeof names[field] === 'string'
            && names[field].trim()
            ? names[field].trim()
            : field;
        result[name] = value;
    }
    return result;
}

function inlineComments(fields, key, options) {
    if (options.comments !== undefined) return requirePayloadArray(options.comments, `jira issue ${key} comments`);
    if (options.requireNestedCollections === false) return [];
    const commentBlock = requirePayloadObject(fields.comment, `jira issue ${key} comment field`);
    return requirePayloadArray(commentBlock.comments, `jira issue ${key} comment field comments`);
}

export function normalizeJiraIssue(issue, config, options = {}) {
    const row = requirePayloadObject(issue, 'jira issue');
    const key = requirePayloadString(row.key, 'issue key', 'jira issue');
    const fields = requirePayloadObject(row.fields, `jira issue ${key} fields`);
    const rendered = row.renderedFields && typeof row.renderedFields === 'object' && !Array.isArray(row.renderedFields)
        ? row.renderedFields
        : {};
    const selectedFields = configuredIssueFields();
    const custom = configuredFieldNames();
    const requireNestedCollections = selectedFields === null && options.requireNestedCollections !== false;
    const comments = inlineComments(fields, key, { ...options, requireNestedCollections });
    const attachments = requireNestedCollections
        ? requirePayloadArray(fields.attachment, `jira issue ${key} attachment field`)
        : [];
    const issueLinks = requireNestedCollections
        ? requirePayloadArray(fields.issuelinks, `jira issue ${key} issuelinks field`)
        : [];
    const normalized = {
        key,
        id: row.id != null ? String(row.id) : '',
        url: `${config.baseUrl}/browse/${key}`,
        summary: String(fields.summary ?? ''),
        issueType: valueName(fields.issuetype) || undefined,
        status: valueName(fields.status) || undefined,
        priority: valueName(fields.priority) || undefined,
        project: valueName(fields.project) || undefined,
        reporter: displayUser(fields.reporter) || undefined,
        assignee: displayUser(fields.assignee) || undefined,
        labels: Array.isArray(fields.labels) ? fields.labels.map(String) : [],
        description: {
            raw: fields.description ?? null,
            markdown: jiraBodyToMarkdown(fields.description, rendered.description),
        },
        comments: comments.map(normalizeComment),
        attachments: attachments.map(normalizeAttachment),
        linkedIssues: issueLinks.map(normalizeIssueLink),
        fixVersions: valueNames(fields.fixVersions),
        affectedVersions: valueNames(fields.versions),
        components: valueNames(fields.components),
        created: fields.created ? String(fields.created) : undefined,
        updated: fields.updated ? String(fields.updated) : undefined,
    };
    if (custom.acceptanceCriteria && fields[custom.acceptanceCriteria] !== undefined) {
        normalized.acceptanceCriteria = {
            raw: fields[custom.acceptanceCriteria],
            markdown: customValueToMarkdown(fields[custom.acceptanceCriteria]),
        };
    }
    if (custom.sprint && fields[custom.sprint] !== undefined) {
        normalized.sprint = customValueToMarkdown(fields[custom.sprint]);
    }
    if (custom.storyPoints && fields[custom.storyPoints] !== undefined) {
        normalized.storyPoints = Number(fields[custom.storyPoints]);
    }
    if (selectedFields !== null) {
        const names = row.names && typeof row.names === 'object' && !Array.isArray(row.names) ? row.names : {};
        if (selectedFields === 'auto') {
            normalized.fields = autoFields(fields, names);
        } else {
            const customFields = {};
            for (const field of selectedFields) {
                if (!field.startsWith('customfield_') || fields[field] === undefined) continue;
                const name = typeof names[field] === 'string' && names[field].trim() ? names[field].trim() : field;
                customFields[name] = fields[field];
            }
            if (Object.keys(customFields).length > 0) normalized.customFields = customFields;
        }
    }
    return normalized;
}

export function issueSummaryRow(issue, config) {
    const normalized = normalizeJiraIssue(issue, config, { comments: [], requireNestedCollections: false });
    return {
        key: normalized.key,
        summary: normalized.summary,
        issueType: normalized.issueType,
        status: normalized.status,
        priority: normalized.priority,
        assignee: normalized.assignee,
        updated: normalized.updated,
        url: normalized.url,
    };
}

export async function fetchIssue(config, key, extraFields = []) {
    const fields = issueFields(extraFields);
    const params = {
        expand: 'renderedFields,names',
    };
    if (fields !== undefined) params.fields = fields;
    const issue = await jiraRequest(config, `/issue/${encodeURIComponent(key)}`, {
        params,
        label: `jira issue ${key}`,
    });
    return requirePayloadObject(issue, `jira issue ${key}`);
}

export async function fetchComments(config, key, limit = 100) {
    const maxResults = parseJiraLimit(limit, 100, 100);
    const data = await jiraRequest(config, `/issue/${encodeURIComponent(key)}/comment`, {
        params: { startAt: 0, maxResults, expand: 'renderedBody' },
        label: `jira comments ${key}`,
    });
    const payload = requirePayloadObject(data, `jira comments ${key}`);
    return requirePayloadArray(payload.comments, `jira comments ${key}`);
}

export function jiraRowsOrEmpty(rows, label, hint) {
    return requireNonEmptyRows(rows, label, hint);
}

export function jiraConfig() {
    return getJiraConfig();
}

export const __test__ = {
    configuredFieldNames,
    fetchIssue,
    issueSummaryRow,
    jiraApiPath,
    jiraBodyToMarkdown,
    normalizeAttachment,
    normalizeComment,
    normalizeIssueLink,
    normalizeJiraIssue,
    requireIssueKey,
};
