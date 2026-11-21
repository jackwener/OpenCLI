import {
    ArgumentError,
    AuthRequiredError,
    CommandExecutionError,
    EmptyResultError,
} from '@jackwener/opencli/errors';
import { log } from '@jackwener/opencli/logger';

const CONTENT_FEED_TYPE = 250;
const MOMENT_TYPE = 74;
const CONTENT_ENTITY_TYPES = new Set([8, 73]);
const COMPANY_RESULT_TYPE = 205;
const CONTENT_RESULT_TYPE = 207;
const MOMENT_RESULT_TYPE = 201;
const JOB_RESULT_TYPE = 213;
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

function optionalId(value, label) {
    if (value == null || value === '' || value === 0 || value === '0') return '';
    return requiredId(value, label);
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

function bestEffortId(value) {
    try {
        return optionalId(value, 'author id');
    }
    catch {
        return '';
    }
}

function authorFields(userBrief, expectedId, label, anonymous = false) {
    const author = isRecord(userBrief) ? userBrief : {};
    const authorId = bestEffortId(author.userId);
    const entityAuthorId = bestEffortId(expectedId);
    if (!anonymous && authorId && entityAuthorId && authorId !== entityAuthorId) {
        throw new CommandExecutionError(`Nowcoder returned mismatched ${label} authorship`);
    }
    return {
        author: typeof author.nickname === 'string' ? author.nickname.trim() : '',
        author_id: authorId,
        author_url: authorId ? `https://www.nowcoder.com/users/${authorId}` : '',
        school: typeof author.educationInfo === 'string' ? author.educationInfo.trim() : '',
    };
}

function isAnonymous(data, post) {
    return post?.isAnonymousFlag === true || data?.userBrief?.nickname === '匿名牛油';
}

function commonFeedFields(data, post, postType, authorId, timestamp, metadata) {
    if (!isRecord(data.frequencyData)) throw new CommandExecutionError(`Nowcoder returned malformed ${postType} frequencyData`);
    const anonymous = isAnonymous(data, post);
    return {
        post_type: postType,
        rc_type: metadata.rcType,
        content_type: metadata.contentType,
        entity_type: metadata.entityType,
        is_anonymous: anonymous,
        title: optionalText(post.title, `${postType} title`) || '(untitled)',
        ...authorFields(data.userBrief, authorId, postType, anonymous),
        content: cleanBody(post.content, `${postType} content`),
        likes: metric(data.frequencyData, 'likeCnt'),
        comments: metric(data.frequencyData, 'commentCnt'),
        views: metric(data.frequencyData, 'viewCnt'),
        time: isoTime(timestamp, `${postType} timestamp`),
    };
}

function projectContentFeed(data, requireOuterId, rcType) {
    if (!isRecord(data)) throw new CommandExecutionError('Nowcoder returned a malformed feed row');
    if (data.contentType !== CONTENT_FEED_TYPE) throw new CommandExecutionError(`Nowcoder returned unsupported content contentType ${String(data.contentType)}`);
    if (!isRecord(data.contentData) || data.momentData != null) {
        throw new CommandExecutionError('Nowcoder returned mismatched content feed data');
    }
    const post = data.contentData;
    if (!CONTENT_ENTITY_TYPES.has(post.entityType)) {
        throw new CommandExecutionError(`Nowcoder returned unsupported content entity type ${String(post.entityType)}`);
    }
    const id = requiredId(post.id, 'content id');
    if ((requireOuterId || data.contentId != null) && id !== requiredId(data.contentId, 'content feed id')) {
        throw new CommandExecutionError('Nowcoder returned mismatched content feed identity');
    }
    return {
        ...commonFeedFields(data, post, 'content', post.authorId, post.createTime, {
            rcType,
            contentType: CONTENT_FEED_TYPE,
            entityType: post.entityType,
        }),
        id,
        uuid: requiredUuid(post.uuid, 'content uuid'),
        entity_id: requiredId(post.entityId, 'content entity id'),
        url: `https://www.nowcoder.com/discuss/${id}`,
    };
}

function projectMomentFeed(data, requireOuterId, rcType) {
    if (!isRecord(data)) throw new CommandExecutionError('Nowcoder returned a malformed feed row');
    if (data.contentType !== MOMENT_TYPE) throw new CommandExecutionError(`Nowcoder returned unsupported moment contentType ${String(data.contentType)}`);
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
        ...commonFeedFields(data, post, 'moment', post.userId, post.createdAt, {
            rcType,
            contentType: MOMENT_TYPE,
            entityType: MOMENT_TYPE,
        }),
        id: uuid,
        uuid,
        entity_id: entityId,
        url: `https://www.nowcoder.com/feed/main/detail/${uuid}`,
    };
}

function jobTime(job) {
    for (const value of [job.updateTime, job.refreshTime, job.createTime]) {
        if (Number.isSafeInteger(value) && value > 0) return isoTime(value, 'job timestamp');
    }
    return '';
}

function projectJob(item, rcType) {
    if (!isRecord(item) || !isRecord(item.data)) throw new CommandExecutionError('Nowcoder returned a malformed job record');
    const job = item.data;
    return {
        post_type: 'job',
        rc_type: rcType,
        content_type: '',
        entity_type: '',
        is_anonymous: false,
        id: requiredId(job.id ?? item.entityDataId, 'job id'),
        uuid: '',
        entity_id: requiredId(item.entityDataId ?? job.id, 'job entity id'),
        url: '',
        title: optionalText(job.jobName, 'job title') || '(untitled)',
        author: '',
        author_id: '',
        author_url: '',
        school: '',
        content: '',
        likes: '',
        comments: '',
        views: '',
        time: jobTime(job),
        company: optionalText(job.recommendInternCompany?.companyName, 'job company'),
        company_id: optionalId(job.companyId, 'job company id'),
        job_rc_type: Number.isSafeInteger(item.rc_type) ? item.rc_type : '',
    };
}

function reasonFromError(error) {
    return String(error?.message ?? error)
        .replace(/^Nowcoder returned\s+/i, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function skippedRecord(index, type, reason, rcType = '', contentType = '') {
    return { index, type, reason, rcType, contentType };
}

function reportSkip(source, skipped) {
    log.verbose(
        `Nowcoder ${source} skipped row ${skipped.index + 1}: type=${skipped.type}, `
        + `rc_type=${skipped.rcType === '' ? '-' : skipped.rcType}, `
        + `content_type=${skipped.contentType === '' ? '-' : skipped.contentType}, reason=${skipped.reason}`,
    );
}

function parseWithRowRecovery(index, type, rcType, contentType, parse) {
    try {
        return { row: parse(), skipped: null };
    }
    catch (error) {
        return {
            row: null,
            skipped: skippedRecord(index, type, reasonFromError(error), rcType, contentType),
        };
    }
}

function addSkipped(source, skipped, item) {
    skipped.push(item);
    reportSkip(source, item);
}

function skippedSummary(skipped) {
    const counts = new Map();
    for (const item of skipped) {
        const key = `${item.type}:${item.reason}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, count]) => `${key}${count > 1 ? ` x${count}` : ''}`)
        .join(', ');
}

export function projectNowcoderFeed(records, limit, source, wrapped = false) {
    if (!Array.isArray(records)) throw new CommandExecutionError(`Nowcoder ${source} returned malformed records`);
    if (records.length === 0) throw new EmptyResultError(`nowcoder ${source}`, 'Nowcoder returned no content or moment posts.');

    const rows = [];
    const skipped = [];
    const requireOuterId = source === 'experience' || wrapped;

    for (let index = 0; index < records.length && rows.length < limit; index += 1) {
        const record = records[index];
        if (wrapped) {
            if (!isRecord(record)) {
                addSkipped(source, skipped, skippedRecord(index, 'unknown', 'malformed wrapped record'));
                continue;
            }
            const rcType = record.rc_type;
            if (rcType === CONTENT_RESULT_TYPE) {
                const result = parseWithRowRecovery(index, 'content', rcType, CONTENT_FEED_TYPE, () => projectContentFeed(record.data, true, rcType));
                if (result.row) rows.push(result.row);
                else addSkipped(source, skipped, result.skipped);
                continue;
            }
            if (rcType === MOMENT_RESULT_TYPE) {
                const result = parseWithRowRecovery(index, 'moment', rcType, MOMENT_TYPE, () => projectMomentFeed(record.data, true, rcType));
                if (result.row) rows.push(result.row);
                else addSkipped(source, skipped, result.skipped);
                continue;
            }
            if (rcType === JOB_RESULT_TYPE) {
                if (!Array.isArray(record.data) || record.data.length === 0) {
                    addSkipped(source, skipped, skippedRecord(index, 'job', 'job group has no array data', rcType));
                    continue;
                }
                for (let jobIndex = 0; jobIndex < record.data.length && rows.length < limit; jobIndex += 1) {
                    const result = parseWithRowRecovery(index, 'job', rcType, '', () => projectJob(record.data[jobIndex], rcType));
                    if (result.row) rows.push(result.row);
                    else {
                        addSkipped(source, skipped, {
                            ...result.skipped,
                            reason: `job[${jobIndex}]: ${result.skipped.reason}`,
                        });
                    }
                }
                continue;
            }
            if (rcType === COMPANY_RESULT_TYPE) {
                addSkipped(source, skipped, skippedRecord(index, 'company', 'unsupported company result', rcType));
                continue;
            }
            addSkipped(source, skipped, skippedRecord(index, 'unknown', `unsupported rc_type ${String(rcType)}`, rcType));
            continue;
        }

        if (!isRecord(record)) {
            addSkipped(source, skipped, skippedRecord(index, 'unknown', 'malformed direct record'));
            continue;
        }
        const rcType = Number.isSafeInteger(record.rc_type) ? record.rc_type : '';
        if (record.contentType === CONTENT_FEED_TYPE) {
            const result = parseWithRowRecovery(index, 'content', rcType, CONTENT_FEED_TYPE, () => projectContentFeed(record, requireOuterId, rcType));
            if (result.row) rows.push(result.row);
            else addSkipped(source, skipped, result.skipped);
            continue;
        }
        if (record.contentType === MOMENT_TYPE) {
            const result = parseWithRowRecovery(index, 'moment', rcType, MOMENT_TYPE, () => projectMomentFeed(record, requireOuterId, rcType));
            if (result.row) rows.push(result.row);
            else addSkipped(source, skipped, result.skipped);
            continue;
        }
        addSkipped(source, skipped, skippedRecord(index, 'unknown', `unsupported contentType ${String(record.contentType)}`, rcType, record.contentType));
    }

    if (rows.length === 0) {
        throw new CommandExecutionError(
            `Nowcoder ${source} skipped all ${records.length} records: ${skippedSummary(skipped)}`,
            'The response contained only unsupported or malformed search record variants.',
        );
    }
    return rows.slice(0, limit).map((row, index) => ({ ...row, rank: index + 1 }));
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
    if (isContent ? !CONTENT_ENTITY_TYPES.has(data.entityType) : data.entityType !== MOMENT_TYPE) {
        throw new CommandExecutionError('Nowcoder detail returned a mismatched post entity type');
    }
    const uuid = requiredUuid(data.uuid, `${target.post_type} uuid`);
    const entityId = requiredId(data.entityId, `${target.post_type} entity id`);
    const id = isContent ? requiredId(data.id, 'content id') : uuid;
    if (isContent ? id !== target.value : uuid !== target.value) throw new CommandExecutionError('Nowcoder detail returned a different post identity');
    if (!isContent && entityId !== requiredId(data.id, 'moment id')) throw new CommandExecutionError('Nowcoder detail returned mismatched moment entity ids');
    const expectedAuthorId = isContent ? data.authorId : data.userId;
    const body = cleanBody(isContent ? data.richText : data.content, `${target.post_type} detail body`);
    const anonymous = !isContent && isAnonymous(data, data);
    return {
        post_type: target.post_type,
        content_type: isContent ? CONTENT_FEED_TYPE : MOMENT_TYPE,
        entity_type: data.entityType,
        is_anonymous: anonymous,
        id,
        uuid,
        entity_id: entityId,
        url: isContent
            ? `https://www.nowcoder.com/discuss/${id}`
            : `https://www.nowcoder.com/feed/main/detail/${uuid}`,
        title: optionalText(data.title, `${target.post_type} title`) || '(untitled)',
        ...authorFields(data.userBrief, expectedAuthorId, target.post_type, anonymous),
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
