/** Self-contained projector: serialized into the browser evaluation context. */
export function projectNowcoderDetail(data, requestedId = '') {
    const toString = (value) => value == null ? '' : String(value).trim();
    const user = data?.userBrief || {};
    const frequency = data?.frequencyData || {};
    const authorId = toString(user.userId || user.user_id || user.id || user.uid);
    const id = toString(data?.uuid || data?.contentData?.uuid || data?.contentId || data?.id || requestedId);
    const html = toString(data?.content);
    const content = html
        .replace(/<\s*br\s*\/?>/gi, '\n')
        .replace(/<\/(?:p|div|li)>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    let time = '';
    if (data?.createdAt != null && data.createdAt !== '') {
        const date = new Date(data.createdAt);
        if (!Number.isNaN(date.getTime()))
            time = date.toISOString();
    }
    return {
        id,
        url: id ? `https://www.nowcoder.com/discuss/${encodeURIComponent(id)}` : '',
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
export function projectNowcoderSearchItem(item, index) {
    const toString = (value) => value == null ? '' : String(value).trim();
    const strip = (html) => toString(html)
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ')
        .trim();
    const data = item?.data || {};
    const moment = data.momentData || {};
    const contentData = data.contentData || {};
    const user = data.userBrief || {};
    const id = toString(moment.uuid || contentData.uuid || data.contentId || moment.id || contentData.id);
    const authorId = toString(user.userId || user.user_id || user.id || user.uid);
    return {
        rank: index + 1,
        title: toString(moment.title || contentData.title || user.nickname),
        author: toString(user.nickname),
        author_id: authorId,
        author_url: authorId ? `https://www.nowcoder.com/users/${encodeURIComponent(authorId)}` : '',
        school: toString(user.educationInfo),
        content: strip(moment.content || contentData.content),
        id,
        url: id ? `https://www.nowcoder.com/discuss/${encodeURIComponent(id)}` : '',
    };
}

/** Self-contained projector: serialized into the browser evaluation context. */
export function projectNowcoderExperienceItem(item, index) {
    const toString = (value) => value == null ? '' : String(value).trim();
    const user = item?.userBrief || {};
    const content = item?.contentData || {};
    const frequency = item?.frequencyData || {};
    const id = toString(content.uuid || content.id || item?.contentId);
    const authorId = toString(user.userId || user.user_id || user.id || user.uid);
    return {
        rank: index + 1,
        title: toString(content.title),
        author: toString(user.nickname),
        author_id: authorId,
        author_url: authorId ? `https://www.nowcoder.com/users/${encodeURIComponent(authorId)}` : '',
        school: toString(user.educationInfo),
        likes: frequency.likeCnt || 0,
        comments: frequency.commentCnt || 0,
        views: frequency.viewCnt || 0,
        id,
        url: id ? `https://www.nowcoder.com/discuss/${encodeURIComponent(id)}` : '',
    };
}
