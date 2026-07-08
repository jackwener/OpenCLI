import { readFile, stat } from 'node:fs/promises';
import { htmlToMarkdown as coreHtmlToMarkdown } from '@jackwener/opencli/utils';
import {
    ArgumentError,
    AuthRequiredError,
    CommandExecutionError,
    ConfigError,
    EmptyResultError,
} from '@jackwener/opencli/errors';

const USER_AGENT = 'opencli-atlassian-adapter (+https://github.com/jackwener/opencli)';
const DEPLOYMENTS = new Set(['cloud', 'datacenter', 'auto']);

function firstEnv(names) {
    for (const name of names) {
        const value = process.env[name]?.trim();
        if (value) return value;
    }
    return '';
}

function normalizeBaseUrl(value, label) {
    const raw = String(value ?? '').trim();
    if (!raw) {
        throw new ConfigError(`Missing ${label}`, `Set ${label}, for example https://example.atlassian.net`);
    }
    let parsed;
    try {
        parsed = new URL(raw);
    } catch {
        throw new ConfigError(`Invalid ${label}: ${raw}`, 'Use an absolute http(s) URL.');
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw new ConfigError(`Invalid ${label}: ${raw}`, 'Use an http(s) URL.');
    }
    parsed.hash = '';
    parsed.search = '';
    return parsed.toString().replace(/\/+$/, '');
}

function parseDeployment(raw, baseUrl) {
    const value = String(raw || 'auto').trim().toLowerCase();
    if (!DEPLOYMENTS.has(value)) {
        throw new ConfigError('Invalid ATLASSIAN_DEPLOYMENT', 'Expected one of: cloud, datacenter, auto.');
    }
    if (value !== 'auto') return value;
    const host = new URL(baseUrl).hostname;
    return host === 'atlassian.net' || host.endsWith('.atlassian.net') ? 'cloud' : 'datacenter';
}

function appendPath(baseUrl, suffix) {
    const base = new URL(baseUrl);
    const path = base.pathname.replace(/\/+$/, '');
    base.pathname = `${path}${suffix}`;
    return base.toString().replace(/\/+$/, '');
}

function normalizeConfluenceBaseUrl(baseUrl, deployment) {
    if (deployment !== 'cloud') return baseUrl;
    const parsed = new URL(baseUrl);
    const normalized = parsed.pathname.replace(/\/+$/, '');
    if (normalized === '/wiki' || normalized.endsWith('/wiki')) return baseUrl;
    return appendPath(baseUrl, '/wiki');
}

function basicAuth(user, token) {
    return `Basic ${Buffer.from(`${user}:${token}`, 'utf8').toString('base64')}`;
}

function resolveAuthHeaders(deployment, productLabel) {
    const bearer = firstEnv(['ATLASSIAN_BEARER_TOKEN', 'ATLASSIAN_OAUTH_TOKEN']);
    if (bearer) return { Authorization: `Bearer ${bearer}` };

    const pat = firstEnv(['ATLASSIAN_PAT', `${productLabel.toUpperCase()}_PAT`]);
    if (deployment === 'datacenter' && pat) return { Authorization: `Bearer ${pat}` };

    const prefix = productLabel.toUpperCase();
    const email = firstEnv(['ATLASSIAN_EMAIL', 'ATLASSIAN_USERNAME', `${prefix}_EMAIL`, `${prefix}_USERNAME`]);
    const token = firstEnv(['ATLASSIAN_API_TOKEN', 'ATLASSIAN_PASSWORD', `${prefix}_API_TOKEN`, `${prefix}_PASSWORD`]);
    if (email && token) return { Authorization: basicAuth(email, token) };

    if (deployment === 'cloud') {
        throw new ConfigError(
            'Missing Atlassian Cloud credentials',
            'Set ATLASSIAN_EMAIL and ATLASSIAN_API_TOKEN, or set ATLASSIAN_BEARER_TOKEN for OAuth.',
        );
    }
    throw new ConfigError(
        'Missing Atlassian Data Center credentials',
        'Set ATLASSIAN_PAT, ATLASSIAN_BEARER_TOKEN, or ATLASSIAN_USERNAME plus ATLASSIAN_PASSWORD.',
    );
}

export function getJiraConfig() {
    const baseUrl = normalizeBaseUrl(firstEnv(['ATLASSIAN_JIRA_BASE_URL', 'JIRA_BASE_URL']), 'ATLASSIAN_JIRA_BASE_URL');
    const deployment = parseDeployment(process.env.ATLASSIAN_DEPLOYMENT, baseUrl);
    return {
        product: 'jira',
        baseUrl,
        deployment,
        authHeaders: resolveAuthHeaders(deployment, 'jira'),
    };
}

export function getConfluenceConfig() {
    const initialBaseUrl = normalizeBaseUrl(
        firstEnv(['ATLASSIAN_CONFLUENCE_BASE_URL', 'CONFLUENCE_BASE_URL']),
        'ATLASSIAN_CONFLUENCE_BASE_URL',
    );
    const deployment = parseDeployment(process.env.ATLASSIAN_DEPLOYMENT, initialBaseUrl);
    return {
        product: 'confluence',
        baseUrl: normalizeConfluenceBaseUrl(initialBaseUrl, deployment),
        deployment,
        authHeaders: resolveAuthHeaders(deployment, 'confluence'),
    };
}

function joinUrl(baseUrl, apiPath) {
    if (/^https?:\/\//i.test(apiPath)) return apiPath;
    const path = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
    return `${baseUrl}${path}`;
}

function summarizeApiError(parsed, fallback) {
    if (parsed && typeof parsed === 'object') {
        const messages = [];
        if (Array.isArray(parsed.errorMessages)) messages.push(...parsed.errorMessages.filter(Boolean));
        if (typeof parsed.message === 'string') messages.push(parsed.message);
        if (typeof parsed.error === 'string') messages.push(parsed.error);
        if (typeof parsed.reason === 'string') messages.push(parsed.reason);
        if (parsed.errors && typeof parsed.errors === 'object') {
            for (const [key, value] of Object.entries(parsed.errors)) {
                messages.push(`${key}: ${String(value)}`);
            }
        }
        if (messages.length) return messages.join(' · ');
    }
    if (typeof parsed === 'string' && parsed.trim()) return parsed.trim().slice(0, 300);
    return fallback;
}

async function parseResponseBody(resp, label) {
    let text;
    try {
        text = await resp.text();
    } catch (err) {
        throw new CommandExecutionError(
            `${label} response body could not be read: ${err?.message ?? err}`,
            'Check whether the Atlassian instance, proxy, or network interrupted the response.',
        );
    }
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
}

export async function atlassianRequest(config, apiPath, options = {}) {
    const method = (options.method ?? 'GET').toUpperCase();
    const label = options.label ?? `${config.product} ${method} ${apiPath}`;
    const headers = {
        'user-agent': USER_AGENT,
        accept: 'application/json',
        ...config.authHeaders,
        ...(options.headers ?? {}),
    };
    let body;
    if (options.body !== undefined) {
        headers['content-type'] = headers['content-type'] ?? 'application/json';
        body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
    }

    let resp;
    const url = joinUrl(config.baseUrl, apiPath);
    try {
        resp = await fetch(url, { method, headers, body });
    } catch (err) {
        throw new CommandExecutionError(
            `${label} request failed: ${err?.message ?? err}`,
            'Check the Atlassian base URL, VPN/network access, and proxy settings.',
        );
    }

    const parsed = await parseResponseBody(resp, label);
    if (resp.status === 401) {
        throw new AuthRequiredError(
            config.baseUrl,
            `${label} returned HTTP 401`,
            'Check Atlassian credentials and whether this instance accepts the configured auth method.',
        );
    }
    if (resp.status === 403) {
        throw new AuthRequiredError(
            config.baseUrl,
            `${label} returned HTTP 403: ${summarizeApiError(parsed, 'forbidden')}`,
            'The authenticated user lacks permission for this Jira issue, Confluence page, or space.',
        );
    }
    if (resp.status === 404) {
        throw new EmptyResultError(label, `Atlassian returned 404 for ${url}.`);
    }
    if (resp.status === 409) {
        throw new CommandExecutionError(
            `${label} returned HTTP 409: ${summarizeApiError(parsed, 'version conflict')}`,
            'Reload the current Confluence page version and retry the update.',
        );
    }
    if (resp.status === 429) {
        throw new CommandExecutionError(`${label} returned HTTP 429 (rate limited)`, 'Wait and retry with a smaller limit.');
    }
    if (!resp.ok) {
        throw new CommandExecutionError(`${label} returned HTTP ${resp.status}: ${summarizeApiError(parsed, resp.statusText)}`);
    }
    if (typeof parsed === 'string') {
        throw new CommandExecutionError(
            `${label} returned a non-JSON response`,
            'Expected Atlassian REST API JSON. Check the base URL and whether an HTML login, SSO, or proxy page was returned.',
        );
    }
    return parsed;
}

export function queryString(params) {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null || value === '') continue;
        if (Array.isArray(value)) {
            for (const item of value) qs.append(key, String(item));
        } else {
            qs.set(key, String(value));
        }
    }
    const s = qs.toString();
    return s ? `?${s}` : '';
}

export function requireString(value, label) {
    const s = String(value ?? '').trim();
    if (!s) throw new ArgumentError(`${label} is required`);
    return s;
}

export function requirePayloadObject(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new CommandExecutionError(`${label} returned an unexpected payload shape; expected an object.`);
    }
    return value;
}

export function requirePayloadArray(value, label) {
    if (!Array.isArray(value)) {
        throw new CommandExecutionError(`${label} returned an unexpected payload shape; expected an array.`);
    }
    return value;
}

export function requirePayloadString(value, field, label) {
    if (typeof value !== 'string' && typeof value !== 'number') {
        throw new CommandExecutionError(`${label} did not include a stable ${field}.`);
    }
    const s = String(value).trim();
    if (!s) throw new CommandExecutionError(`${label} did not include a stable ${field}.`);
    return s;
}

export function requireNonEmptyRows(rows, label, hint) {
    if (!rows.length) throw new EmptyResultError(label, hint);
    return rows;
}

export function parseLimit(value, defaultValue = 20, maxValue = 100, label = 'limit') {
    const raw = value ?? defaultValue;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
        throw new ArgumentError(`${label} must be a positive integer`);
    }
    if (n > maxValue) {
        throw new ArgumentError(`${label} must be <= ${maxValue}`);
    }
    return n;
}

export function requireExecute(args, commandName) {
    if (args.execute !== true) {
        throw new ArgumentError(`${commandName} requires --execute to perform a remote write`);
    }
}

export async function readUtf8File(filePath) {
    const path = requireString(filePath, '--file');
    let fileStat;
    try {
        fileStat = await stat(path);
    } catch {
        throw new ArgumentError(`File not found: ${path}`);
    }
    if (!fileStat.isFile()) {
        throw new ArgumentError(`File must be a readable text file: ${path}`);
    }
    let raw;
    try {
        raw = await readFile(path);
    } catch {
        throw new ArgumentError(`File could not be read: ${path}`);
    }
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(raw);
    } catch {
        throw new ArgumentError(`File could not be decoded as UTF-8 text: ${path}`);
    }
}

export function htmlEscape(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export function htmlToMarkdown(html) {
    return coreHtmlToMarkdown(String(html ?? ''));
}

function applyAdfMarks(text, marks = []) {
    let out = text;
    for (const mark of marks) {
        const type = mark?.type;
        if (type === 'link' && mark.attrs?.href) out = `[${out}](${mark.attrs.href})`;
        else if (type === 'strong') out = `**${out}**`;
        else if (type === 'em') out = `_${out}_`;
        else if (type === 'code') out = `\`${out}\``;
        else if (type === 'strike') out = `~~${out}~~`;
    }
    return out;
}

function renderAdfNode(node, depth = 0) {
    if (!node || typeof node !== 'object') return '';
    const content = Array.isArray(node.content) ? node.content : [];
    const renderChildren = (sep = '') => content.map((child) => renderAdfNode(child, depth)).filter(Boolean).join(sep);
    switch (node.type) {
        case 'doc':
            return content.map((child) => renderAdfNode(child, depth)).filter(Boolean).join('\n\n').trim();
        case 'paragraph':
            return renderChildren('');
        case 'text':
            return applyAdfMarks(String(node.text ?? ''), Array.isArray(node.marks) ? node.marks : []);
        case 'hardBreak':
            return '\n';
        case 'heading':
            return `${'#'.repeat(Math.max(1, Math.min(6, Number(node.attrs?.level ?? 2))))} ${renderChildren('')}`;
        case 'bulletList':
            return content.map((child) => renderAdfListItem(child, depth, '-')).join('\n');
        case 'orderedList':
            return content.map((child, i) => renderAdfListItem(child, depth, `${i + 1}.`)).join('\n');
        case 'listItem':
            return renderChildren('\n');
        case 'codeBlock':
            return `\`\`\`\n${renderChildren('')}\n\`\`\``;
        case 'blockquote':
            return renderChildren('\n').split('\n').map((line) => `> ${line}`).join('\n');
        case 'rule':
            return '---';
        case 'table':
            return renderAdfTable(content);
        case 'tableRow':
            return content.map((cell) => escapeMarkdownTableCell(renderAdfNode(cell, depth))).join(' | ');
        case 'tableHeader':
        case 'tableCell':
            return renderChildren(' ').replace(/\s+/g, ' ').trim();
        case 'mention':
            return node.attrs?.text ? String(node.attrs.text) : '';
        case 'emoji':
            return String(node.attrs?.shortName ?? node.attrs?.text ?? '');
        case 'inlineCard':
            return node.attrs?.url ? String(node.attrs.url) : '';
        default:
            return renderChildren('');
    }
}

function renderAdfListItem(node, depth, marker) {
    const indent = '  '.repeat(depth);
    const body = renderAdfNode(node, depth + 1).trim();
    const lines = body.split('\n');
    const [first, ...rest] = lines;
    return `${indent}${marker} ${first ?? ''}${rest.length ? `\n${rest.map((line) => `${indent}  ${line}`).join('\n')}` : ''}`;
}

function escapeMarkdownTableCell(value) {
    return String(value ?? '').replace(/\|/g, '\\|').replace(/\n+/g, '<br>').trim();
}

function renderAdfTable(rows) {
    const matrix = rows
        .map((row) => {
            const cells = Array.isArray(row?.content) ? row.content : [];
            return cells.map((cell) => escapeMarkdownTableCell(renderAdfNode(cell)));
        })
        .filter((row) => row.length > 0);
    if (!matrix.length) return '';
    const colCount = Math.max(...matrix.map((row) => row.length));
    const normalize = (row) => Array.from({ length: colCount }, (_value, index) => row[index] ?? '').join(' | ');
    return [
        normalize(matrix[0]),
        Array.from({ length: colCount }, () => '---').join(' | '),
        ...matrix.slice(1).map(normalize),
    ].join('\n');
}

export function adfToMarkdown(value) {
    if (!value) return '';
    if (typeof value === 'string') return value.trim();
    return renderAdfNode(value).trim();
}

function renderInlineMarkdown(value) {
    const src = String(value ?? '');
    const linkRe = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
    let out = '';
    let last = 0;
    for (const match of src.matchAll(linkRe)) {
        out += htmlEscape(src.slice(last, match.index));
        out += `<a href="${htmlEscape(match[2])}">${htmlEscape(match[1])}</a>`;
        last = match.index + match[0].length;
    }
    out += htmlEscape(src.slice(last));
    return out
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/`([^`]+)`/g, '<code>$1</code>');
}

function isMarkdownTable(lines, index) {
    return lines[index]?.includes('|') && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1] ?? '');
}

function parseTableRow(line) {
    return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

function renderMarkdownTable(lines, start) {
    const rows = [];
    let index = start;
    rows.push(parseTableRow(lines[index]));
    index += 2;
    while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        rows.push(parseTableRow(lines[index]));
        index += 1;
    }
    const htmlRows = rows.map((row, rowIndex) => {
        const tag = rowIndex === 0 ? 'th' : 'td';
        return `<tr>${row.map((cell) => `<${tag}>${renderInlineMarkdown(cell)}</${tag}>`).join('')}</tr>`;
    }).join('');
    return { html: `<table><tbody>${htmlRows}</tbody></table>`, next: index };
}

export function markdownToConfluenceStorage(markdown) {
    const lines = String(markdown ?? '').replace(/\r\n/g, '\n').split('\n');
    const out = [];
    let i = 0;
    let inCode = false;
    let codeLines = [];
    const listStack = [];

    const closeOneList = () => {
        const current = listStack.pop();
        if (!current) return;
        if (current.liOpen) out.push('</li>');
        out.push(`</${current.tag}>`);
    };

    const closeListsTo = (indent) => {
        while (listStack.length && listStack[listStack.length - 1].indent > indent) closeOneList();
    };

    const closeAllLists = () => {
        while (listStack.length) closeOneList();
    };

    const openList = (tag, indent) => {
        out.push(`<${tag}>`);
        listStack.push({ tag, indent, liOpen: false });
    };

    const renderListItem = (tag, indent, text) => {
        closeListsTo(indent);
        let current = listStack[listStack.length - 1];
        if (current && current.indent === indent && current.tag !== tag) {
            closeOneList();
            current = listStack[listStack.length - 1];
        }
        if (!current || current.indent < indent) {
            openList(tag, indent);
            current = listStack[listStack.length - 1];
        }
        if (current.indent === indent && current.liOpen) {
            out.push('</li>');
            current.liOpen = false;
        }
        out.push(`<li>${renderInlineMarkdown(text)}`);
        current.liOpen = true;
    };

    while (i < lines.length) {
        const line = lines[i];
        const fence = line.match(/^```/);
        if (fence) {
            if (inCode) {
                out.push(`<ac:structured-macro ac:name="code"><ac:plain-text-body><![CDATA[${codeLines.join('\n')}]]></ac:plain-text-body></ac:structured-macro>`);
                codeLines = [];
                inCode = false;
            } else {
                closeAllLists();
                inCode = true;
            }
            i += 1;
            continue;
        }
        if (inCode) {
            codeLines.push(line);
            i += 1;
            continue;
        }
        if (!line.trim()) {
            closeAllLists();
            i += 1;
            continue;
        }
        if (isMarkdownTable(lines, i)) {
            closeAllLists();
            const table = renderMarkdownTable(lines, i);
            out.push(table.html);
            i = table.next;
            continue;
        }
        const heading = line.match(/^(#{1,6})\s+(.+)$/);
        if (heading) {
            closeAllLists();
            out.push(`<h${heading[1].length}>${renderInlineMarkdown(heading[2])}</h${heading[1].length}>`);
            i += 1;
            continue;
        }
        const unordered = line.match(/^(\s*)[-*]\s+(.+)$/);
        const ordered = line.match(/^(\s*)\d+\.\s+(.+)$/);
        if (unordered || ordered) {
            const match = unordered || ordered;
            const indent = match[1].replace(/\t/g, '  ').length;
            renderListItem(unordered ? 'ul' : 'ol', indent, match[2]);
            i += 1;
            continue;
        }
        closeAllLists();
        out.push(`<p>${renderInlineMarkdown(line)}</p>`);
        i += 1;
    }

    closeAllLists();
    if (inCode) {
        out.push(`<ac:structured-macro ac:name="code"><ac:plain-text-body><![CDATA[${codeLines.join('\n')}]]></ac:plain-text-body></ac:structured-macro>`);
    }
    return out.join('\n');
}

export const __test__ = {
    adfToMarkdown,
    atlassianRequest,
    getConfluenceConfig,
    getJiraConfig,
    htmlToMarkdown,
    markdownToConfluenceStorage,
    parseLimit,
    queryString,
};
