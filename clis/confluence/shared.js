import {
    atlassianRequest,
    getConfluenceConfig,
    htmlToMarkdown,
    markdownToConfluenceStorage,
    queryString,
    requirePayloadArray,
    requirePayloadObject,
    requirePayloadString,
    readUtf8File,
    requireString,
} from '../_atlassian/shared.js';
import { CommandExecutionError } from '@jackwener/opencli/errors';

export function confluenceConfig() {
    return getConfluenceConfig();
}

function confluenceUrl(config, link) {
    if (!link) return '';
    if (/^https?:\/\//i.test(link)) return link;
    return `${config.baseUrl}${link.startsWith('/') ? link : `/${link}`}`;
}

function pageStorageBody(page) {
    return page?.body?.storage?.value
        ?? page?.body?.view?.value
        ?? '';
}

export function normalizeConfluencePage(page, config) {
    const row = requirePayloadObject(page, 'confluence page');
    const id = requirePayloadString(row.id, 'page id', 'confluence page');
    const title = requirePayloadString(row.title, 'title', 'confluence page');
    const storage = pageStorageBody(row);
    const version = row.version?.number != null ? Number(row.version.number) : undefined;
    const links = row._links && typeof row._links === 'object' && !Array.isArray(row._links) ? row._links : {};
    const webui = links.webui ?? links.tinyui ?? '';
    return {
        id,
        title,
        status: String(row.status ?? ''),
        spaceId: row.spaceId != null ? String(row.spaceId) : undefined,
        spaceKey: row.space?.key ? String(row.space.key) : undefined,
        parentId: row.parentId != null ? String(row.parentId) : undefined,
        version,
        createdAt: row.createdAt ? String(row.createdAt) : undefined,
        updatedAt: row.version?.createdAt ?? row.version?.when ?? undefined,
        url: confluenceUrl(config, webui),
        body: {
            storage,
            markdown: htmlToMarkdown(storage),
        },
    };
}

export async function getPage(config, pageId) {
    if (config.deployment === 'cloud') {
        const page = await atlassianRequest(config, `/api/v2/pages/${encodeURIComponent(pageId)}${queryString({ 'body-format': 'storage' })}`, {
            label: `confluence page ${pageId}`,
        });
        return requirePayloadObject(page, `confluence page ${pageId}`);
    }
    const page = await atlassianRequest(config, `/rest/api/content/${encodeURIComponent(pageId)}${queryString({ expand: 'body.storage,version,space,ancestors' })}`, {
        label: `confluence page ${pageId}`,
    });
    return requirePayloadObject(page, `confluence page ${pageId}`);
}

export async function readPageBodyFile(args) {
    const text = await readUtf8File(args.file);
    if (args.representation === 'storage') return text;
    return markdownToConfluenceStorage(text);
}

export function createPagePayload(config, args, storage) {
    const title = requireString(args.title, 'Confluence page title');
    const space = requireString(args.space, 'Confluence space');
    if (config.deployment === 'cloud') {
        return {
            spaceId: space,
            status: 'current',
            title,
            ...(args.parent ? { parentId: String(args.parent) } : {}),
            body: { representation: 'storage', value: storage },
        };
    }
    return {
        type: 'page',
        status: 'current',
        title,
        space: { key: space },
        ...(args.parent ? { ancestors: [{ id: String(args.parent) }] } : {}),
        body: { storage: { representation: 'storage', value: storage } },
    };
}

export function updatePagePayload(config, current, args, storage) {
    const page = requirePayloadObject(current, 'confluence current page');
    const id = requirePayloadString(page.id, 'page id', 'confluence current page');
    const title = args.title ? requireString(args.title, 'Confluence page title') : requirePayloadString(page.title, 'title', 'confluence current page');
    const currentVersion = Number(page.version?.number);
    if (!Number.isSafeInteger(currentVersion) || currentVersion < 1) {
        throw new CommandExecutionError('confluence update could not determine the current page version.');
    }
    const nextVersion = currentVersion + 1;
    if (config.deployment === 'cloud') {
        return {
            id,
            status: 'current',
            title,
            body: { representation: 'storage', value: storage },
            version: {
                number: nextVersion,
                ...(args['version-message'] ? { message: String(args['version-message']) } : {}),
            },
        };
    }
    return {
        id,
        type: 'page',
        status: 'current',
        title,
        body: { storage: { representation: 'storage', value: storage } },
        version: {
            number: nextVersion,
            ...(args['version-message'] ? { message: String(args['version-message']) } : {}),
        },
    };
}

export function normalizeSearchResult(result, config) {
    const row = requirePayloadObject(result, 'confluence search result');
    const content = row.content ?? row;
    const contentObject = requirePayloadObject(content, 'confluence search result content');
    const id = requirePayloadString(contentObject.id, 'content id', 'confluence search result');
    const title = requirePayloadString(row.title ?? contentObject.title, 'title', 'confluence search result');
    const space = row.space ?? contentObject.space ?? {};
    return {
        id,
        title,
        type: String(contentObject.type ?? row.entityType ?? ''),
        spaceKey: String(space?.key ?? ''),
        status: String(contentObject.status ?? ''),
        lastModified: String(row.lastModified ?? contentObject.version?.when ?? contentObject.version?.createdAt ?? ''),
        url: confluenceUrl(config, row.url ?? contentObject._links?.webui ?? ''),
        excerpt: row.excerpt ? htmlToMarkdown(row.excerpt) : '',
    };
}

export function confluenceResults(data, label) {
    const payload = requirePayloadObject(data, label);
    return requirePayloadArray(payload.results, label);
}

export function withSpaceCql(cql, space) {
    const q = String(cql ?? '').trim();
    const s = String(space ?? '').trim();
    if (!s) return q;
    const escaped = s.replace(/"/g, '\\"');
    if (!q) return `space = "${escaped}"`;
    return `space = "${escaped}" and (${q})`;
}

export const __test__ = {
    createPagePayload,
    getPage,
    normalizeConfluencePage,
    normalizeSearchResult,
    readPageBodyFile,
    updatePagePayload,
    withSpaceCql,
};
