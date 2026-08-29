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
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';

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

export function parseIssueFieldSelection(raw) {
    if (raw === undefined) return null;
    if (typeof raw !== 'string') {
        throw new ArgumentError('Jira --fields must be a comma-separated string or auto');
    }

    const parts = raw.split(',').map((field) => field.trim());
    if (parts.length === 0 || parts.some((field) => !field)) {
        throw new ArgumentError(
            'Invalid Jira --fields selection',
            'Use comma-separated field ids without empty entries, for example summary,status,customfield_12345.',
        );
    }
    if (parts.some((field) => field.toLowerCase() === 'auto')) {
        if (parts.length !== 1) {
            throw new ArgumentError('Jira --fields auto cannot be combined with other field ids');
        }
        return { mode: 'auto' };
    }
    if (parts.some((field) => !/^[A-Za-z][A-Za-z0-9_.:-]*$/.test(field))) {
        throw new ArgumentError(
            'Invalid Jira field id in --fields',
            'Use Jira field ids such as summary, status, or customfield_12345.',
        );
    }
    return { mode: 'selected', ids: [...new Set(parts)] };
}

function issueFields(extraFields = [], selection = null) {
    if (selection?.mode === 'auto') return '*all';
    if (selection?.mode === 'selected') {
        return [...new Set([...selection.ids, ...extraFields.filter(Boolean)])].join(',');
    }
    const configured = Object.values(configuredFieldNames()).filter(Boolean);
    return [...new Set([...DEFAULT_ISSUE_FIELDS, ...configured, ...extraFields.filter(Boolean)])].join(',');
}

export function issueSelectionIncludes(selection, field) {
    return selection === null || selection?.mode === 'auto' || selection?.ids?.includes(field) === true;
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

function inlineComments(fields, key, options) {
    if (options.comments !== undefined) return requirePayloadArray(options.comments, `jira issue ${key} comments`);
    const commentBlock = requirePayloadObject(fields.comment, `jira issue ${key} comment field`);
    return requirePayloadArray(commentBlock.comments, `jira issue ${key} comment field comments`);
}

function selectedFieldRows(fields, names, selection, key) {
    const ids = selection.mode === 'auto' ? Object.keys(fields).sort() : selection.ids;
    return ids.map((id) => {
        if (!Object.prototype.hasOwnProperty.call(fields, id)) {
            throw new CommandExecutionError(`jira issue ${key} did not return requested field ${id}.`);
        }
        const name = typeof names[id] === 'string' && names[id].trim() ? names[id].trim() : id;
        return { id, name, value: fields[id] };
    });
}

export function normalizeJiraIssue(issue, config, options = {}) {
    const row = requirePayloadObject(issue, 'jira issue');
    const key = requirePayloadString(row.key, 'issue key', 'jira issue');
    const fields = requirePayloadObject(row.fields, `jira issue ${key} fields`);
    const rendered = row.renderedFields && typeof row.renderedFields === 'object' && !Array.isArray(row.renderedFields)
        ? row.renderedFields
        : {};
    const selection = options.selection ?? null;
    const custom = configuredFieldNames();
    const includeComments = options.requireNestedCollections !== false && issueSelectionIncludes(selection, 'comment');
    const includeAttachments = options.requireNestedCollections !== false && issueSelectionIncludes(selection, 'attachment');
    const includeIssueLinks = options.requireNestedCollections !== false && issueSelectionIncludes(selection, 'issuelinks');
    const comments = includeComments ? inlineComments(fields, key, options) : [];
    const attachments = includeAttachments
        ? requirePayloadArray(fields.attachment, `jira issue ${key} attachment field`)
        : [];
    const issueLinks = includeIssueLinks
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
    if (selection !== null) {
        const names = row.names && typeof row.names === 'object' && !Array.isArray(row.names) ? row.names : {};
        normalized.selectedFields = selectedFieldRows(fields, names, selection, key);
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

export async function fetchIssue(config, key, extraFields = [], selection = null) {
    const params = {
        fields: issueFields(extraFields, selection),
        expand: selection === null ? 'renderedFields' : 'renderedFields,names',
    };
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
    issueFields,
    issueSelectionIncludes,
    issueSummaryRow,
    jiraApiPath,
    jiraBodyToMarkdown,
    normalizeAttachment,
    normalizeComment,
    normalizeIssueLink,
    normalizeJiraIssue,
    parseIssueFieldSelection,
    requireIssueKey,
};
