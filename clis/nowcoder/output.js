/** Parse a detail target into the endpoint-specific identifier Nowcoder accepts. */
export function parseNowcoderPostTarget(raw) {
    const nowcoderHosts = new Set(['nowcoder.com', 'www.nowcoder.com']);
    const value = String(raw ?? '').trim();
    if (!value)
        throw new Error('Nowcoder detail requires a post ID, moment UUID, or canonical URL');
    if (/^\d+$/.test(value))
        return { post_type: 'content', value };
    if (/^[a-f\d]{32}$/i.test(value))
        return { post_type: 'moment', value: value.toLowerCase() };

    let url;
    try {
        url = new URL(value);
    }
    catch {
        throw new Error('Unsupported Nowcoder detail target');
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !nowcoderHosts.has(url.hostname.toLowerCase())) {
        throw new Error('Nowcoder detail only accepts https://nowcoder.com URLs');
    }
    const content = url.pathname.match(/^\/discuss\/(\d+)(?:\/|$)/);
    if (content)
        return { post_type: 'content', value: content[1] };
    const moment = url.pathname.match(/^\/feed\/main\/detail\/([a-f\d]{32})(?:\/|$)/i);
    if (moment)
        return { post_type: 'moment', value: moment[1].toLowerCase() };
    throw new Error('Unsupported Nowcoder URL; expected /discuss/<content-id> or /feed/main/detail/<moment-uuid>');
}

/** Self-contained projector: serialized into the browser evaluation context. */
export function projectNowcoderDetail(data, postType) {
    const toString = (value) => value == null ? '' : String(value).trim();
    const user = data?.userBrief || {};
    const frequency = data?.frequencyData || {};
    const authorId = toString(user.userId || user.user_id || user.id || user.uid || data?.authorId || data?.userId);
    const uuid = toString(data?.uuid);
    const id = postType === 'moment' ? uuid : toString(data?.id);
    const entityId = toString(data?.entityId || (postType === 'moment' ? data?.id : ''));
    const html = toString(data?.content);
    const content = html
        .replace(/<\s*br\s*\/?>/gi, '\n')
        .replace(/<\/(?:p|div|li|pre)>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/&amp;/gi, '&')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    const rawTime = postType === 'moment'
        ? (data?.createdAt ?? data?.createTime)
        : (data?.createTime ?? data?.createdAt);
    let time = '';
    if (rawTime != null && rawTime !== '') {
        let value = rawTime;
        if (typeof value === 'string' && /^\d+$/.test(value.trim()))
            value = Number(value);
        if (typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 1_000_000_000_000)
            value *= 1000;
        const date = new Date(value);
        if (!Number.isNaN(date.getTime()))
            time = date.toISOString();
    }
    const url = postType === 'moment'
        ? (uuid ? `https://www.nowcoder.com/feed/main/detail/${encodeURIComponent(uuid)}` : '')
        : (id ? `https://www.nowcoder.com/discuss/${encodeURIComponent(id)}` : '');
    return {
        post_type: postType,
        id,
        uuid,
        entity_id: entityId,
        url,
        title: toString(data?.title) || '(untitled)',
        author: toString(user.nickname),
        author_id: authorId,
        author_url: authorId ? `https://www.nowcoder.com/users/${encodeURIComponent(authorId)}` : '',
        school: toString(user.educationInfo),
        content,
        likes: frequency.likeCnt || 0,
        comments: frequency.commentCnt || frequency.totalCommentCnt || 0,
        views: frequency.viewCnt || 0,
        time,
        location: toString(data?.ip4Location),
    };
}

/** Self-contained projector: serialized into the browser evaluation context. */
export function projectNowcoderFeedItem(item, index) {
    const toString = (value) => value == null ? '' : String(value).trim();
    const content = item?.contentData || null;
    const moment = item?.momentData || null;
    const postType = content ? 'content' : moment ? 'moment' : '';
    const post = content || moment || {};
    const user = item?.userBrief || {};
    const frequency = item?.frequencyData || {};
    const authorId = toString(user.userId || user.user_id || user.id || user.uid || post.authorId || post.userId);
    const uuid = toString(post.uuid);
    const id = postType === 'content'
        ? toString(content?.id || item?.contentId)
        : postType === 'moment' ? uuid : '';
    const entityId = postType === 'content'
        ? toString(content?.entityId)
        : postType === 'moment' ? toString(moment?.entityId || moment?.id || item?.contentId) : '';
    const url = postType === 'content'
        ? (id ? `https://www.nowcoder.com/discuss/${encodeURIComponent(id)}` : '')
        : postType === 'moment' && uuid
            ? `https://www.nowcoder.com/feed/main/detail/${encodeURIComponent(uuid)}`
            : '';
    return {
        rank: index + 1,
        post_type: postType,
        id,
        uuid,
        entity_id: entityId,
        url,
        title: toString(post.title),
        author: toString(user.nickname),
        author_id: authorId,
        author_url: authorId ? `https://www.nowcoder.com/users/${encodeURIComponent(authorId)}` : '',
        school: toString(user.educationInfo),
        likes: frequency.likeCnt || 0,
        comments: frequency.commentCnt || 0,
        views: frequency.viewCnt || 0,
    };
}

/** Self-contained projector: serialized into the browser evaluation context. */
export function projectNowcoderSearchItem(item, index) {
    const toString = (value) => value == null ? '' : String(value).trim();
    const strip = (html) => toString(html)
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&nbsp;/gi, ' ')
        .trim();
    const data = item?.data || {};
    const content = data.contentData || null;
    const moment = data.momentData || null;
    const postType = content ? 'content' : moment ? 'moment' : '';
    const post = content || moment || {};
    const user = data.userBrief || {};
    const authorId = toString(user.userId || user.user_id || user.id || user.uid || post.authorId || post.userId);
    const uuid = toString(post.uuid);
    const id = postType === 'content'
        ? toString(content?.id || data.contentId)
        : postType === 'moment' ? uuid : '';
    const entityId = postType === 'content'
        ? toString(content?.entityId)
        : postType === 'moment' ? toString(moment?.entityId || moment?.id || data.contentId) : '';
    const url = postType === 'content'
        ? (id ? `https://www.nowcoder.com/discuss/${encodeURIComponent(id)}` : '')
        : postType === 'moment' && uuid
            ? `https://www.nowcoder.com/feed/main/detail/${encodeURIComponent(uuid)}`
            : '';
    return {
        rank: index + 1,
        post_type: postType,
        id,
        uuid,
        entity_id: entityId,
        url,
        title: toString(post.title || user.nickname),
        author: toString(user.nickname),
        author_id: authorId,
        author_url: authorId ? `https://www.nowcoder.com/users/${encodeURIComponent(authorId)}` : '',
        school: toString(user.educationInfo),
        content: strip(post.content),
    };
}
