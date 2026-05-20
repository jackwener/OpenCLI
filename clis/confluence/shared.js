import {
    atlassianRequest,
    getConfluenceConfig,
    htmlToMarkdown,
    markdownToConfluenceStorage,
    queryString,
    readUtf8File,
} from '../_atlassian/shared.js';

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
    const storage = pageStorageBody(page);
    const version = page?.version?.number != null ? Number(page.version.number) : undefined;
    const links = page?._links ?? {};
    const webui = links.webui ?? links.tinyui ?? '';
    return {
        id: String(page?.id ?? ''),
        title: String(page?.title ?? ''),
        status: String(page?.status ?? ''),
        spaceId: page?.spaceId != null ? String(page.spaceId) : undefined,
        spaceKey: page?.space?.key ? String(page.space.key) : undefined,
        parentId: page?.parentId != null ? String(page.parentId) : undefined,
        version,
        createdAt: page?.createdAt ? String(page.createdAt) : undefined,
        updatedAt: page?.version?.createdAt ?? page?.version?.when ?? undefined,
        url: confluenceUrl(config, webui),
        body: {
            storage,
            markdown: htmlToMarkdown(storage),
        },
    };
}

export async function getPage(config, pageId) {
    if (config.deployment === 'cloud') {
        return atlassianRequest(config, `/api/v2/pages/${encodeURIComponent(pageId)}${queryString({ 'body-format': 'storage' })}`, {
            label: `confluence page ${pageId}`,
        });
    }
    return atlassianRequest(config, `/rest/api/content/${encodeURIComponent(pageId)}${queryString({ expand: 'body.storage,version,space,ancestors' })}`, {
        label: `confluence page ${pageId}`,
    });
}

export async function readPageBodyFile(args) {
    const text = await readUtf8File(args.file);
    if (args.representation === 'storage') return text;
    return markdownToConfluenceStorage(text);
}

export function createPagePayload(config, args, storage) {
    if (config.deployment === 'cloud') {
        return {
            spaceId: String(args.space),
            status: 'current',
            title: String(args.title),
            ...(args.parent ? { parentId: String(args.parent) } : {}),
            body: { representation: 'storage', value: storage },
        };
    }
    return {
        type: 'page',
        status: 'current',
        title: String(args.title),
        space: { key: String(args.space) },
        ...(args.parent ? { ancestors: [{ id: String(args.parent) }] } : {}),
        body: { storage: { representation: 'storage', value: storage } },
    };
}

export function updatePagePayload(config, current, args, storage) {
    const title = String(args.title || current.title || '');
    const nextVersion = Number(current.version?.number ?? 0) + 1;
    if (config.deployment === 'cloud') {
        return {
            id: String(current.id),
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
        id: String(current.id),
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
    const content = result?.content ?? result;
    const space = result?.space ?? content?.space ?? {};
    return {
        id: String(content?.id ?? ''),
        title: String(result?.title ?? content?.title ?? ''),
        type: String(content?.type ?? result?.entityType ?? ''),
        spaceKey: String(space?.key ?? ''),
        status: String(content?.status ?? ''),
        lastModified: String(result?.lastModified ?? content?.version?.when ?? content?.version?.createdAt ?? ''),
        url: confluenceUrl(config, result?.url ?? content?._links?.webui ?? ''),
        excerpt: result?.excerpt ? htmlToMarkdown(result.excerpt) : '',
    };
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
