import {
    ArgumentError,
    AuthRequiredError,
    CommandExecutionError,
    EmptyResultError,
} from '@jackwener/opencli/errors';

const CONTENT_FEED_TYPE = 250;
const CONTENT_ENTITY_TYPE = 8;
const MOMENT_TYPE = 74;
const UUID_PATTERN = /^[0-9a-f]{32}$/i;
const NUMERIC_ID_PATTERN = /^[1-9]\d*$/;
const NAMED_ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requiredId(value, label) {
    const id = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
    if (typeof id !== 'string' || !NUMERIC_ID_PATTERN.test(id)) throw new CommandExecutionError(`Nowcoder returned a malformed ${label}`);
    return id;
}

function requiredUuid(value, label) {
    if (typeof value !== 'string' || !UUID_PATTERN.test(value)) throw new CommandExecutionError(`Nowcoder returned a malformed ${label}`);
    return value.toLowerCase();
}

function optionalText(value, label) {
    if (value == null) return '';
    if (typeof value !== 'string') throw new CommandExecutionError(`Nowcoder returned a malformed ${label}`);
    return value.trim();
}

function decodeEntities(value) {
    return value.replace(/&(#x[0-9a-f]+|#\d+|nbsp|amp|lt|gt|quot|apos);/gi, (match, entity) => {
        const normalized = entity.toLowerCase();
        if (NAMED_ENTITIES[normalized] != null) return NAMED_ENTITIES[normalized];
        const radix = normalized.startsWith('#x') ? 16 : 10;
        const codePoint = Number.parseInt(normalized.slice(radix === 16 ? 2 : 1), radix);
        return Number.isSafeInteger(codePoint) && codePoint > 0 && codePoint <= 0x10ffff
            ? String.fromCodePoint(codePoint)
            : match;
    });
}

function cleanBody(html, label) {
    if (typeof html !== 'string') throw new CommandExecutionError(`Nowcoder returned a malformed ${label}`);
    const withoutUnsafe = html.replace(/<\s*(?:script|style)\b[^>]*>[\s\S]*?<\s*\/\s*(?:script|style)\s*>/gi, '');
    const preBlocks = [];
    const protectedHtml = withoutUnsafe.replace(/<\s*pre\b[^>]*>([\s\S]*?)<\s*\/\s*pre\s*>/gi, (_match, body) => {
        let token = `\u0000NOWCODER_PRE_${preBlocks.length}\u0000`;
        while (withoutUnsafe.includes(token)) token += '_';
        const text = decodeEntities(body
            .replace(/<img\b[^>]*\balt\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>/gi, (_image, doubleQuoted, singleQuoted) => `\n${doubleQuoted ?? singleQuoted ?? ''}\n`)
            .replace(/<\s*br\s*\/?>/gi, '\n')
            .replace(/<[^>]+>/g, ''))
            .replace(/\r\n?/g, '\n')
            .split('\n')
            .map((line) => line.replace(/[\t ]+$/g, ''))
            .join('\n')
            .replace(/^\n+|\n+$/g, '');
        preBlocks.push({ token, text });
        return `\n${token}\n`;
    });
    let text = decodeEntities(protectedHtml
        .replace(/<img\b[^>]*\balt\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>/gi, (_match, doubleQuoted, singleQuoted) => `\n${doubleQuoted ?? singleQuoted ?? ''}\n`)
        .replace(/<\s*br\s*\/?>/gi, '\n')
        .replace(/<\s*li\b[^>]*>/gi, '\n- ')
        .replace(/<\s*\/\s*(?:p|div|li|ol|ul|pre|blockquote|h[1-6]|tr)\s*>/gi, '\n')
        .replace(/<\s*(?:p|div|ol|ul|pre|blockquote|h[1-6]|tr)\b[^>]*>/gi, '\n')
        .replace(/<\s*\/\s*(?:td|th)\s*>/gi, '\t')
        .replace(/<[^>]+>/g, ''))
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map((line) => line.replace(/[\t ]+/g, ' ').trim())
        .join('\n')
        .replace(/^\s+|\s+$/g, '')
        .replace(/\n{3,}/g, '\n\n');
    for (const block of preBlocks) text = text.replace(block.token, block.text);
    return text;
}

function isoTime(value, label) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new CommandExecutionError(`Nowcoder returned a malformed ${label}`);
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new CommandExecutionError(`Nowcoder returned a malformed ${label}`);
    return date.toISOString();
}

function metric(frequency, key) {
    const value = frequency[key];
    if (!Number.isSafeInteger(value) || value < 0) throw new CommandExecutionError(`Nowcoder returned a malformed frequencyData.${key}`);
    return value;
}

function authorFields(userBrief, expectedId, label) {
    if (!isRecord(userBrief)) throw new CommandExecutionError(`Nowcoder returned malformed ${label} authorship`);
    const authorId = requiredId(userBrief.userId, `${label} userBrief.userId`);
    if (authorId !== requiredId(expectedId, `${label} author id`)) throw new CommandExecutionError(`Nowcoder returned mismatched ${label} authorship`);
    return {
        author: optionalText(userBrief.nickname, `${label} author nickname`),
        author_id: authorId,
        author_url: `https://www.nowcoder.com/users/${authorId}`,
        school: optionalText(userBrief.educationInfo, `${label} author education`),
    };
}

function commonFeedFields(data, post, postType, authorId, timestamp, index) {
    if (!isRecord(data.frequencyData)) throw new CommandExecutionError(`Nowcoder returned malformed ${postType} frequencyData`);
    return {
        rank: index + 1,
        post_type: postType,
        title: optionalText(post.title, `${postType} title`) || '(untitled)',
        ...authorFields(data.userBrief, authorId, postType),
        content: cleanBody(post.content, `${postType} content`),
        likes: metric(data.frequencyData, 'likeCnt'),
        comments: metric(data.frequencyData, 'commentCnt'),
        views: metric(data.frequencyData, 'viewCnt'),
        time: isoTime(timestamp, `${postType} timestamp`),
    };
}

function projectFeedData(data, index, requireOuterId) {
    if (!isRecord(data)) throw new CommandExecutionError('Nowcoder returned a malformed feed row');
    if (data.contentType === CONTENT_FEED_TYPE) {
        if (!isRecord(data.contentData) || data.momentData != null || data.contentData.entityType !== CONTENT_ENTITY_TYPE) {
            throw new CommandExecutionError('Nowcoder returned mismatched content feed data');
        }
        const post = data.contentData;
        const id = requiredId(post.id, 'content id');
        if ((requireOuterId || data.contentId != null) && id !== requiredId(data.contentId, 'content feed id')) {
            throw new CommandExecutionError('Nowcoder returned mismatched content feed identity');
        }
        const uuid = requiredUuid(post.uuid, 'content uuid');
        return {
            ...commonFeedFields(data, post, 'content', post.authorId, post.createTime, index),
            id,
            uuid,
            entity_id: requiredId(post.entityId, 'content entity id'),
            url: `https://www.nowcoder.com/discuss/${id}`,
        };
    }
    if (data.contentType === MOMENT_TYPE) {
        if (!isRecord(data.momentData) || data.contentData != null) {
            throw new CommandExecutionError('Nowcoder returned mismatched moment feed data');
        }
        const post = data.momentData;
        const entityId = requiredId(post.id, 'moment entity id');
        if ((requireOuterId || data.contentId != null) && entityId !== requiredId(data.contentId, 'moment feed id')) {
            throw new CommandExecutionError('Nowcoder returned mismatched moment feed identity');
        }
        const uuid = requiredUuid(post.uuid, 'moment uuid');
        return {
            ...commonFeedFields(data, post, 'moment', post.userId, post.createdAt, index),
            id: uuid,
            uuid,
            entity_id: entityId,
            url: `https://www.nowcoder.com/feed/main/detail/${uuid}`,
        };
    }
    throw new CommandExecutionError(`Nowcoder returned unsupported feed contentType ${String(data.contentType)}`);
}

export function projectNowcoderFeed(records, limit, source, wrapped = false) {
    if (!Array.isArray(records)) throw new CommandExecutionError(`Nowcoder ${source} returned malformed records`);
    const rows = [];
    for (const record of records) {
        const data = wrapped ? record?.data : record;
        rows.push(projectFeedData(data, rows.length, source === 'experience' || wrapped));
    }
    if (rows.length === 0) throw new EmptyResultError(`nowcoder ${source}`, 'Nowcoder returned no content or moment posts.');
    return rows.slice(0, limit);
}

export function parseNowcoderPostTarget(raw) {
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (NUMERIC_ID_PATTERN.test(value)) return { post_type: 'content', value };
    if (UUID_PATTERN.test(value)) return { post_type: 'moment', value: value.toLowerCase() };

    let url;
    try {
        url = new URL(value);
    }
    catch {
        throw new ArgumentError('nowcoder detail requires a numeric content ID, moment UUID, or canonical Nowcoder URL');
    }
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash
        || (host !== 'nowcoder.com' && host !== 'www.nowcoder.com')) {
        throw new ArgumentError('nowcoder detail only accepts canonical https://www.nowcoder.com post URLs');
    }
    const content = url.pathname.match(/^\/discuss\/([1-9]\d*)\/?$/);
    if (content) return { post_type: 'content', value: content[1] };
    const moment = url.pathname.match(/^\/feed\/main\/detail\/([0-9a-f]{32})\/?$/i);
    if (moment) return { post_type: 'moment', value: moment[1].toLowerCase() };
    throw new ArgumentError('Unsupported Nowcoder URL; expected /discuss/<content-id> or /feed/main/detail/<moment-uuid>');
}

export function projectNowcoderDetail(data, target) {
    if (!isRecord(data) || !isRecord(data.frequencyData)) throw new CommandExecutionError('Nowcoder detail returned malformed post data');
    const isContent = target.post_type === 'content';
    const expectedEntityType = isContent ? CONTENT_ENTITY_TYPE : MOMENT_TYPE;
    if (data.entityType !== expectedEntityType) throw new CommandExecutionError('Nowcoder detail returned a mismatched post entity type');
    const uuid = requiredUuid(data.uuid, `${target.post_type} uuid`);
    const entityId = requiredId(data.entityId, `${target.post_type} entity id`);
    const id = isContent ? requiredId(data.id, 'content id') : uuid;
    if (isContent ? id !== target.value : uuid !== target.value) throw new CommandExecutionError('Nowcoder detail returned a different post identity');
    if (!isContent && entityId !== requiredId(data.id, 'moment id')) throw new CommandExecutionError('Nowcoder detail returned mismatched moment entity ids');
    const expectedAuthorId = isContent ? data.authorId : data.userId;
    const body = cleanBody(isContent ? data.richText : data.content, `${target.post_type} detail body`);
    return {
        post_type: target.post_type,
        id,
        uuid,
        entity_id: entityId,
        url: isContent
            ? `https://www.nowcoder.com/discuss/${id}`
            : `https://www.nowcoder.com/feed/main/detail/${uuid}`,
        title: optionalText(data.title, `${target.post_type} title`) || '(untitled)',
        ...authorFields(data.userBrief, expectedAuthorId, target.post_type),
        content: body,
        likes: metric(data.frequencyData, 'likeCnt'),
        comments: metric(data.frequencyData, 'commentCnt'),
        views: metric(data.frequencyData, 'viewCnt'),
        time: isoTime(isContent ? data.createTime : data.createdAt, `${target.post_type} timestamp`),
        location: optionalText(data.ip4Location, `${target.post_type} location`),
    };
}

export function requirePositiveInt(value, name, maximum) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 1 || number > maximum) throw new ArgumentError(`nowcoder --${name} must be an integer from 1 to ${maximum}`);
    return number;
}

export async function fetchNowcoderData(page, url, options, label) {
    let payload;
    try {
        await page.goto('https://www.nowcoder.com');
        payload = await page.fetchJson(url, options);
    }
    catch (error) {
        const detail = String(error?.message ?? error);
        if (/HTTP\s+(401|403)|need login|not logged in/i.test(detail)) {
            throw new AuthRequiredError('nowcoder.com', `${label} requires a logged-in Nowcoder session`);
        }
        throw new CommandExecutionError(`${label} failed: ${detail}`);
    }
    if (!isRecord(payload) || typeof payload.success !== 'boolean' || !Number.isSafeInteger(payload.code)) throw new CommandExecutionError(`${label} returned a malformed envelope`);
    const message = typeof payload.msg === 'string' ? payload.msg : 'unknown error';
    if (!payload.success || payload.code !== 0) {
        if (payload.code === 999 || /need login|登录/i.test(message)) {
            throw new AuthRequiredError('nowcoder.com', `${label} requires a logged-in Nowcoder session: ${message}`);
        }
        throw new CommandExecutionError(`${label} failed: ${message} (${payload.code})`);
    }
    if (!isRecord(payload.data)) throw new CommandExecutionError(`${label} returned malformed data`);
    return payload.data;
}
