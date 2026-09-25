import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

export const GUTENBERG_BASE = 'https://www.gutenberg.org';
const PAGE_SIZE = 25;

export function requireString(value, label) {
    const text = String(value ?? '').trim();
    if (!text) throw new ArgumentError(`gutenberg ${label} must not be empty`);
    return text;
}

export function requirePositiveInteger(value, defaultValue, label) {
    const raw = value ?? defaultValue;
    const number = Number(raw);
    if (!Number.isInteger(number) || number <= 0) {
        throw new ArgumentError(`gutenberg ${label} must be a positive integer`);
    }
    return number;
}

export function requireBoundedInt(value, defaultValue, maxValue, label) {
    const number = requirePositiveInteger(value, defaultValue, label);
    if (number > maxValue) throw new ArgumentError(`gutenberg ${label} must be <= ${maxValue}`);
    return number;
}

export function requireId(value, label = 'id') {
    const raw = String(value ?? '').trim().replace(/^https?:\/\/www\.gutenberg\.org\/ebooks\//i, '').replace(/\/.*$/, '');
    if (!/^\d+$/.test(raw) || Number(raw) <= 0) {
        throw new ArgumentError(`gutenberg ${label} must be a positive integer`);
    }
    return raw;
}

export function requireChoice(value, defaultValue, choices, label) {
    const selected = String(value ?? defaultValue).trim().toLowerCase();
    if (!choices.includes(selected)) {
        throw new ArgumentError(`gutenberg ${label} must be one of: ${choices.join(', ')}`);
    }
    return selected;
}

export function normalizePeriod(value) {
    const aliases = {
        yesterday: 'yesterday',
        '7days': '7days',
        '30days': '30days',
    };
    const period = aliases[String(value ?? 'yesterday').trim().toLowerCase()];
    if (!period) throw new ArgumentError('gutenberg period must be one of: yesterday, 7days, 30days');
    return period;
}

export function normalizeInitial(value) {
    const initial = String(value ?? '').trim().toUpperCase();
    if (initial && !/^[A-Z]$/.test(initial)) {
        throw new ArgumentError('gutenberg initial must be one uppercase letter from A to Z');
    }
    return initial;
}

export async function fetchText(url, label) {
    let response;
    try {
        response = await fetch(url, {
            headers: {
                Accept: 'text/html, application/xhtml+xml, application/xml;q=0.9, text/xml;q=0.8',
            },
            redirect: 'follow',
        });
    } catch (error) {
        throw new CommandExecutionError(`${label} request failed: ${error?.message || error}`);
    }
    if (response.status === 404) throw new EmptyResultError(label, `Gutenberg resource was not found: ${url}`);
    if (!response.ok) throw new CommandExecutionError(`${label} request failed: HTTP ${response.status}`);
    try {
        return await response.text();
    } catch (error) {
        throw new CommandExecutionError(`${label} response could not be read: ${error?.message || error}`);
    }
}

export function buildUrl(pathname, params = {}) {
    const url = new URL(pathname, GUTENBERG_BASE);
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && String(value) !== '') url.searchParams.set(key, String(value));
    }
    return url.toString();
}

export function decodeHtml(value) {
    return String(value ?? '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<br\s*\/?>(\s*)/gi, ' ')
        .replace(/<[^>]*>/g, '')
        .replace(/&#(x[\da-f]+|\d+);/gi, (_, code) => {
            const number = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : parseInt(code, 10);
            return Number.isFinite(number) ? String.fromCodePoint(number) : '';
        })
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&apos;/gi, "'")
        .replace(/&#39;/g, "'")
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/\s+/g, ' ')
        .trim();
}

function attribute(attrs, name) {
    const match = String(attrs).match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*["']([^"']*)["']`, 'i'));
    return match ? decodeHtml(match[1]) : '';
}

function absoluteUrl(href) {
    return new URL(href, GUTENBERG_BASE).toString();
}

function parseDownloadCount(value) {
    const match = decodeHtml(value).replace(/,/g, '').match(/(\d+)\s+downloads?/i);
    return match ? Number(match[1]) : null;
}

function parseBookItem(block) {
    const linkMatch = block.match(/<a\b([^>]*)>[\s\S]*?<\/a>/i);
    if (!linkMatch) return null;
    const href = attribute(linkMatch[1], 'href');
    const id = href.match(/^\/ebooks\/(\d+)(?:\/|$)/)?.[1];
    const title = decodeHtml(block.match(/<span\s+class=["'][^"']*\btitle\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1]);
    if (!id || !title) return null;
    const author = decodeHtml(block.match(/<span\s+class=["'][^"']*\bsubtitle\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1]);
    const extra = block.match(/<span\s+class=["'][^"']*\bextra\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1];
    return {
        id,
        title,
        author: author || null,
        downloads: parseDownloadCount(extra),
        url: absoluteUrl(`/ebooks/${id}`),
    };
}

function hasClass(attrs, className) {
    return attribute(attrs, 'class').split(/\s+/).includes(className);
}

function hasExplicitEmptyBookList(html) {
    const metaPattern = /<meta\b([^>]*)>/gi;
    let metaMatch;
    while ((metaMatch = metaPattern.exec(html)) !== null) {
        if (attribute(metaMatch[1], 'name').toLowerCase() === 'totalresults'
            && attribute(metaMatch[1], 'content') === '0') return true;
    }
    return /<ul\b[^>]*class=["'][^"']*\bresults\b[^"']*["'][^>]*>[\s\S]*?<span\b[^>]*class=["'][^"']*\btitle\b[^"']*["'][^>]*>\s*No records found\.\s*<\/span>[\s\S]*?<\/ul>/i.test(html);
}

export function parseBookList(html) {
    const candidates = [];
    const pattern = /<li\b([^>]*)>[\s\S]*?<\/li>/gi;
    let match;
    while ((match = pattern.exec(html)) !== null) {
        if (hasClass(match[1], 'booklink')) candidates.push(match[0]);
    }
    const rows = candidates.map(parseBookItem);
    if (rows.some((row) => !row)) {
        throw new CommandExecutionError('gutenberg book list contained a row without a valid ebook id or title');
    }
    if (!candidates.length && !hasExplicitEmptyBookList(html)) {
        throw new CommandExecutionError('gutenberg book list selector drift: book rows and the explicit empty-state marker were not found');
    }
    return rows;
}

async function fetchBookPageSet(pathname, params, label, { limit, requiredIds } = {}) {
    const rows = [];
    const seen = new Set();
    const maxPages = requiredIds ? 1000 : Math.ceil(limit / PAGE_SIZE) + 1;
    for (let page = 1; page <= maxPages && (requiredIds || rows.length < limit); page += 1) {
        const pageParams = { ...params };
        if (page > 1) pageParams.start_index = ((page - 1) * PAGE_SIZE) + 1;
        const pageRows = parseBookList(await fetchText(buildUrl(pathname, pageParams), label));
        for (const row of pageRows) {
            if (!seen.has(row.id) && (requiredIds || rows.length < limit)) {
                seen.add(row.id);
                rows.push(row);
            }
        }
        if (requiredIds && [...requiredIds].every((id) => seen.has(id))) return rows;
        if (pageRows.length < PAGE_SIZE) break;
    }
    if (requiredIds) {
        const missing = [...requiredIds].filter((id) => !seen.has(id));
        if (missing.length) throw new CommandExecutionError(`${label} did not return requested ebook ids: ${missing.join(', ')}`);
        return rows;
    }
    if (!rows.length) throw new EmptyResultError(label, 'Gutenberg returned no matching books');
    return rows;
}

export async function fetchBookPages(pathname, params, limit, label) {
    return fetchBookPageSet(pathname, params, label, { limit });
}

export async function fetchBookPagesForIds(pathname, params, requiredIds, label) {
    return fetchBookPageSet(pathname, params, label, { requiredIds });
}

export function parseBookDetails(html, requestedId) {
    const tableValue = (label) => decodeHtml(html.match(new RegExp(`<th[^>]*>\\s*${label}\\s*<\\/th>\\s*<td[^>]*>([\\s\\S]*?)<\\/td>`, 'i'))?.[1]);
    const title = tableValue('Title') || decodeHtml(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]);
    const ebookNumber = tableValue('eBook-No\\.');
    if (!title || !ebookNumber) throw new CommandExecutionError(`gutenberg ebook ${requestedId} returned an unexpected page shape`);
    if (ebookNumber !== String(requestedId)) {
        throw new CommandExecutionError(`gutenberg ebook ${requestedId} returned ebook ${ebookNumber}`);
    }
    const downloads = tableValue('Downloads').replace(/,/g, '').match(/(\d+)/)?.[1];
    const summary = decodeHtml(html.match(/<div\s+class=["'][^"']*\bsummary-text-container\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1])
        .replace(/\.\.\.\s*Read more\s*Show less$/i, '').trim();
    const subjects = [];
    const subjectPattern = /<td\s+property=["']dcterms:subject["'][^>]*>([\s\S]*?)<\/td>/gi;
    let subjectMatch;
    while ((subjectMatch = subjectPattern.exec(html)) !== null) {
        const subject = decodeHtml(subjectMatch[1]);
        if (subject) subjects.push(subject);
    }
    const readPath = html.match(/<a\s+class=["']read-online-button["'][^>]*\bhref=["']([^"']+)["']/i)?.[1];
    return {
        id: ebookNumber,
        title,
        author: tableValue('Author') || null,
        summary: summary || null,
        language: tableValue('Language') || null,
        subjects: subjects.length ? subjects.join('; ') : null,
        releaseDate: tableValue('Release Date') || null,
        lastUpdate: tableValue('Last Update') || null,
        copyright: tableValue('Copyright') || null,
        downloads: downloads ? Number(downloads) : null,
        readOnlineUrl: readPath ? absoluteUrl(readPath) : null,
        url: absoluteUrl(`/ebooks/${requestedId}`),
        formats: parseFormats(html),
    };
}

export function parseFormats(html) {
    const formats = [];
    const pattern = /<a\s+class=["'][^"']*(?:featured-format-link|other-format-link)[^"']*["']([^>]*)>([\s\S]*?)<\/a>/gi;
    let match;
    while ((match = pattern.exec(html)) !== null) {
        const attrs = match[1];
        const href = attribute(attrs, 'href');
        if (!href) throw new CommandExecutionError('gutenberg ebook format row was missing its download URL');
        const type = attribute(attrs, 'type') || null;
        const title = attribute(attrs, 'title');
        const visibleName = decodeHtml(match[2].match(/<span\s+class=["'][^"']*format-name[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1]);
        const name = (visibleName || title || decodeHtml(match[2]))
            .replace(/^Download\s*/i, '')
            .replace(/^\((.*)\)$/s, '$1')
            .replace(/★[\s\S]*$/, '')
            .trim();
        const rest = html.slice(match.index + match[0].length);
        const nextFormatOffset = rest.search(/<a\s+class=["'][^"']*(?:featured-format-link|other-format-link)[^"']*["'][^>]*>/i);
        const nearby = html.slice(match.index, nextFormatOffset < 0 ? html.length : match.index + match[0].length + nextFormatOffset);
        const size = decodeHtml(nearby.match(/<span\s+class=["'][^"']*format-size[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1]) || null;
        formats.push({ name: name || 'Download', mediaType: type, size, url: absoluteUrl(href) });
    }
    if (!formats.length) {
        throw new CommandExecutionError('gutenberg ebook format selector drift: download format links were not found');
    }
    return formats;
}

function sectionItems(html, sectionId, label) {
    const headingPattern = /<h2\b([^>]*)>[\s\S]*?<\/h2>/gi;
    let headingMatch;
    while ((headingMatch = headingPattern.exec(html)) !== null) {
        if (attribute(headingMatch[1], 'id') !== sectionId) continue;
        const list = html.slice(headingPattern.lastIndex).match(/^\s*<ol\b[^>]*>([\s\S]*?)<\/ol>/i)?.[1];
        if (list === undefined) throw new CommandExecutionError(`${label} ranking list was not found after its heading`);
        const items = [...list.matchAll(/<li\b[^>]*>[\s\S]*?<\/li>/gi)].map((item) => item[0]);
        if (!items.length) throw new CommandExecutionError(`${label} ranking section contained no rows`);
        return items;
    }
    throw new CommandExecutionError(`${label} ranking section was not found`);
}

export function parseHotBooks(html, period) {
    const suffix = period === 'yesterday' ? '1' : period === '7days' ? '7' : '30';
    const items = sectionItems(html, `books-last${suffix}`, 'gutenberg hot books');
    return items.map((item) => {
        const link = item.match(/<a\b([^>]*)>([\s\S]*?)<\/a>/i);
        const href = attribute(link?.[1] || '', 'href');
        const id = href.match(/^\/ebooks\/(\d+)$/)?.[1];
        const text = decodeHtml(link?.[2]);
        const withoutCount = text.replace(/\s+\([\d,]+\)\s*$/g, '').trim();
        const byIndex = withoutCount.lastIndexOf(' by ');
        const title = (byIndex > 0 ? withoutCount.slice(0, byIndex) : withoutCount).trim();
        if (!id || !title) throw new CommandExecutionError('gutenberg hot books contained a row without a valid ebook id or title');
        return { id, title, url: absoluteUrl(href) };
    });
}

export function parseHotAuthors(html, period) {
    const suffix = period === 'yesterday' ? '1' : period === '7days' ? '7' : '30';
    const items = sectionItems(html, `authors-last${suffix}`, 'gutenberg hot authors');
    return items.map((item) => {
        const link = item.match(/<a\b([^>]*)>([\s\S]*?)<\/a>/i);
        const href = attribute(link?.[1] || '', 'href');
        const id = href.match(/^\/browse\/authors\/[^#]+#a(\d+)$/i)?.[1];
        const name = decodeHtml(link?.[2]).replace(/\s+\([\d,]+\)\s*$/g, '').trim();
        if (!id || !name) throw new CommandExecutionError('gutenberg hot authors contained a row without a valid author id or name');
        return { id, name, url: absoluteUrl(href) };
    });
}

export function parseMainCategories(html) {
    const rows = [];
    const blockPattern = /<div\s+class=["']book-list["'][^>]*>([\s\S]*?)<\/div>/gi;
    let blockMatch;
    let blockCount = 0;
    while ((blockMatch = blockPattern.exec(html)) !== null) {
        blockCount += 1;
        const parentName = decodeHtml(blockMatch[1].match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)?.[1]);
        const items = [...blockMatch[1].matchAll(/<li\b[^>]*>[\s\S]*?<\/li>/gi)].map((item) => item[0]);
        if (!parentName || !items.length) throw new CommandExecutionError('gutenberg main categories contained a malformed category group');
        for (const item of items) {
            const link = item.match(/<a\b([^>]*)>([\s\S]*?)<\/a>/i);
            const href = attribute(link?.[1] || '', 'href');
            const id = href.match(/^\/ebooks\/bookshelf\/(\d+)$/)?.[1];
            const name = decodeHtml(link?.[2]);
            if (!id || !name) throw new CommandExecutionError('gutenberg main categories contained a row without a valid category id or name');
            rows.push({ id, name, parentName, url: absoluteUrl(href) });
        }
    }
    if (!blockCount || !rows.length) throw new CommandExecutionError('gutenberg main categories selector drift: category groups were not found');
    return rows;
}

export function parseCollections(html) {
    const start = html.search(/<h2[^>]*>\s*Collections\s*<\/h2>/i);
    const end = html.search(/<h2[^>]*>\s*All Reading Lists\s*<\/h2>/i);
    if (start < 0 || end <= start) throw new CommandExecutionError('gutenberg collections section boundaries were not found');
    const block = html.slice(start, end);
    const items = [...block.matchAll(/<li\b[^>]*>[\s\S]*?<\/li>/gi)].map((item) => item[0]);
    if (!items.length) throw new CommandExecutionError('gutenberg collections section contained no rows');
    return items.map((item) => {
        const link = item.match(/<a\b([^>]*)>([\s\S]*?)<\/a>/i);
        const href = attribute(link?.[1] || '', 'href');
        const validHref = /^\/ebooks\/(?:bookshelves\/search\/[^?#]*\?query=[^#]+|bookshelf\/[^/?#]+)$/.test(href);
        const name = decodeHtml(link?.[2]);
        if (!validHref || !name) throw new CommandExecutionError('gutenberg collections contained a row without a valid name or URL');
        return { name, url: absoluteUrl(href) };
    });
}

function parseCategorySearchItem(block) {
    const link = block.match(/<a\b([^>]*)>([\s\S]*?)<\/a>/i);
    const href = attribute(link?.[1] || '', 'href');
    const id = href.match(/^\/ebooks\/bookshelf\/([^/?#]+)$/)?.[1];
    const name = decodeHtml(link?.[2].match(/<span\s+class=["'][^"']*\btitle\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1]);
    const extra = link?.[2].match(/<span\s+class=["'][^"']*\bextra\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1];
    const downloads = parseDownloadCount(extra);
    if (!id || !name) return null;
    return { id, name, downloads, url: absoluteUrl(href) };
}

export function parseCategorySearchList(html) {
    const candidates = [];
    const pattern = /<li\b([^>]*)>[\s\S]*?<\/li>/gi;
    let match;
    while ((match = pattern.exec(html)) !== null) {
        if (hasClass(match[1], 'navlink')) candidates.push(match[0]);
    }
    const rows = candidates.map(parseCategorySearchItem);
    if (rows.some((row) => !row)) {
        throw new CommandExecutionError('gutenberg category search contained a row without a valid name, download count, or URL');
    }
    if (!candidates.length && !hasExplicitEmptyBookList(html)) {
        throw new CommandExecutionError('gutenberg category search selector drift: category rows and the explicit empty-state marker were not found');
    }
    return rows;
}

function nextPagePath(html) {
    const pattern = /<link\b([^>]*)>/gi;
    let match;
    while ((match = pattern.exec(html)) !== null) {
        const rel = attribute(match[1], 'rel').toLowerCase().split(/\s+/);
        if (!rel.includes('next')) continue;
        const href = attribute(match[1], 'href');
        if (!href) throw new CommandExecutionError('gutenberg category search next-page link was missing its URL');
        const url = new URL(href, GUTENBERG_BASE);
        return `${url.pathname}${url.search}`;
    }
    return '';
}

async function fetchCategorySearchPageSet(query, sort) {
    const rows = [];
    const seen = new Set();
    let nextPath = '/ebooks/bookshelves/search/';
    for (let page = 0; page < 200 && nextPath; page += 1) {
        const html = await fetchText(buildUrl(nextPath, { query, sort_order: sort === 'title' ? 'alpha' : sort }), 'gutenberg category search');
        for (const row of parseCategorySearchList(html)) {
            if (!seen.has(row.id)) {
                seen.add(row.id);
                rows.push(row);
            }
        }
        nextPath = nextPagePath(html);
    }
    if (nextPath) throw new CommandExecutionError('gutenberg category search exceeded the pagination safety limit');
    return rows;
}

export async function fetchCategorySearchPages(query, sort) {
    const rows = await fetchCategorySearchPageSet(query, sort);
    if (!rows.length) throw new EmptyResultError('gutenberg category search', 'Gutenberg returned no matching categories');
    if (sort === 'downloads') {
        if (rows.some((row) => row.downloads === null)) {
            throw new CommandExecutionError('gutenberg category search download counts were missing from the downloads-sorted results');
        }
        return rows;
    }

    const downloadRows = await fetchCategorySearchPageSet(query, 'downloads');
    const downloadsById = new Map(downloadRows.map((row) => [row.id, row.downloads]));
    return rows.map((row) => {
        const downloads = downloadsById.get(row.id);
        if (downloads === undefined || downloads === null) {
            throw new CommandExecutionError(`gutenberg category search did not provide a download count for category ${row.id}`);
        }
        return { ...row, downloads };
    });
}

export function parseCategories(html, initial = '') {
    const start = html.search(/<h2[^>]*>\s*All Reading Lists\s*<\/h2>/i);
    if (start < 0) throw new CommandExecutionError('gutenberg categories section was not found');
    const source = html.slice(start);
    const rows = [];
    const blockPattern = /<div\s+class=["']book-list["'][^>]*>([\s\S]*?)<\/div>/gi;
    let blockMatch;
    let blockCount = 0;
    while ((blockMatch = blockPattern.exec(source)) !== null) {
        blockCount += 1;
        const letter = decodeHtml(blockMatch[1].match(/<h2[^>]*>([A-Z])<\/h2>/i)?.[1]).toUpperCase();
        const items = [...blockMatch[1].matchAll(/<li\b[^>]*>[\s\S]*?<\/li>/gi)].map((item) => item[0]);
        if (!letter || !items.length) throw new CommandExecutionError('gutenberg categories contained a malformed initial group');
        for (const item of items) {
            const link = item.match(/<a\b([^>]*)>([\s\S]*?)<\/a>/i);
            const href = attribute(link?.[1] || '', 'href');
            const id = href.match(/^\/ebooks\/bookshelf\/([^/?#]+)$/)?.[1];
            const name = decodeHtml(link?.[2]);
            if (!id || !name) throw new CommandExecutionError('gutenberg categories contained a row without a valid category id or name');
            rows.push({ id, initial: letter, name, url: absoluteUrl(href) });
        }
    }
    if (!blockCount || !rows.length) throw new CommandExecutionError('gutenberg categories selector drift: category groups were not found');
    return initial ? rows.filter((row) => row.initial === initial) : rows;
}

async function fetchAuthorBookPages(authorId, sort) {
    const rows = [];
    const seen = new Set();
    for (let page = 1; page <= 1000; page += 1) {
        const params = { sort_order: sort };
        if (page > 1) params.start_index = ((page - 1) * PAGE_SIZE) + 1;
        const html = await fetchText(buildUrl(`/ebooks/author/${authorId}`, params), `gutenberg author ${authorId}`);
        const pageRows = parseBookList(html);
        for (const row of pageRows) {
            if (!seen.has(row.id)) {
                seen.add(row.id);
                rows.push(row);
            }
        }
        if (!pageRows.length || pageRows.length < PAGE_SIZE) return rows;
    }
    throw new CommandExecutionError(`gutenberg author ${authorId} exceeded the pagination safety limit`);
}

export async function fetchAllAuthorBooks(authorId, sort) {
    const rows = await fetchAuthorBookPages(authorId, sort);
    if (!rows.length) throw new EmptyResultError(`gutenberg author ${authorId}`, 'The author has no books');
    if (sort === 'downloads') {
        if (rows.some((row) => row.downloads === null)) {
            throw new CommandExecutionError(`gutenberg author ${authorId} download counts were missing from the downloads-sorted results`);
        }
        return rows;
    }

    const downloadRows = await fetchAuthorBookPages(authorId, 'downloads');
    const downloadsById = new Map(downloadRows.map((row) => [row.id, row.downloads]));
    return rows.map((row) => {
        const downloads = downloadsById.get(row.id);
        if (downloads === undefined || downloads === null) {
            throw new CommandExecutionError(`gutenberg author ${authorId} did not provide a download count for ebook ${row.id}`);
        }
        return { ...row, downloads };
    });
}
