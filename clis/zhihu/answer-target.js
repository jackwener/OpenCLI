const ANSWER_ID_RE = /^\d+$/;
const ANSWER_TYPED_RE = /^answer:(\d+):(\d+)$/;
export const ANSWER_PATH_RE = /^\/question\/(\d+)\/answer\/(\d+)\/?$/;
const BARE_ANSWER_PATH_RE = /^\/answer\/(\d+)\/?$/;

// Accepts: bare numeric id (`1937205528846655537`), the typed
// target form used by the existing zhihu write adapters
// (`answer:<qid>:<aid>`), or the full Zhihu URL pasted from a
// browser (`https://www.zhihu.com/question/<qid>/answer/<aid>`).
// Returns string-safe ids, or null when the input does not resolve to
// any of those exact shapes.
export function parseAnswerTarget(input) {
    const value = String(input ?? '').trim();
    if (!value) return null;
    if (ANSWER_ID_RE.test(value)) return { answerId: value, questionId: '' };
    const typed = value.match(ANSWER_TYPED_RE);
    if (typed) return { questionId: typed[1], answerId: typed[2] };
    try {
        const url = new URL(value);
        if (
            url.protocol !== 'https:' ||
            url.username ||
            url.password ||
            url.port ||
            (url.hostname !== 'www.zhihu.com' && url.hostname !== 'zhihu.com')
        ) {
            return null;
        }
        let m = url.pathname.match(ANSWER_PATH_RE);
        if (m) return { questionId: m[1], answerId: m[2] };
        m = url.pathname.match(BARE_ANSWER_PATH_RE);
        if (m) return { answerId: m[1], questionId: '' };
    } catch {
        return null;
    }
    return null;
}
