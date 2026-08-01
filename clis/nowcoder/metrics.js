/**
 * Project Nowcoder frequencyData without conflating a real zero with a
 * missing or malformed field. This function is serialized into the browser
 * evaluation context, so it must remain self-contained.
 */
export function projectNowcoderMetrics(frequencyData) {
    const source = frequencyData && typeof frequencyData === 'object'
        ? frequencyData
        : {};
    const readMetric = (...keys) => {
        for (const key of keys) {
            if (!Object.prototype.hasOwnProperty.call(source, key))
                continue;
            const raw = source[key];
            if (raw == null || raw === '')
                continue;
            const value = typeof raw === 'number' ? raw : Number(String(raw).trim());
            if (Number.isInteger(value) && value >= 0) {
                return { value, status: 'available' };
            }
        }
        return { value: null, status: 'unavailable' };
    };

    const likes = readMetric('likeCnt');
    // Nowcoder calls this followCnt in the API, while the detail UI labels the
    // same interaction 收藏 (collect/save).
    const collects = readMetric('followCnt');
    const comments = readMetric('commentCnt', 'totalCommentCnt');
    const shares = readMetric('shareCnt');
    const views = readMetric('viewCnt');

    return {
        likes: likes.value,
        likes_status: likes.status,
        collects: collects.value,
        collects_status: collects.status,
        comments: comments.value,
        comments_status: comments.status,
        shares: shares.value,
        shares_status: shares.status,
        views: views.value,
        views_status: views.status,
    };
}
