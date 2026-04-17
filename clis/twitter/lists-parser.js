const MEMBER_PATTERNS = [
    /([\d.,]+(?:\s?[KMB千萬万亿])?)\s*members?/i,
    /([\d.,]+(?:\s?[KMB千萬万亿])?)\s*位成员/,
];
const FOLLOWER_PATTERNS = [
    /([\d.,]+(?:\s?[KMB千萬万亿])?)\s*followers?/i,
    /([\d.,]+(?:\s?[KMB千萬万亿])?)\s*位关注者/,
];
const PRIVATE_PATTERNS = [/\bprivate\b/i, /锁定列表/];
const EMPTY_STATE_PATTERNS = [
    /hasn't created any lists/i,
    /has not created any lists/i,
    /no lists yet/i,
    /没有创建任何列表/,
    /还没有创建任何列表/,
];
function normalizeText(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
}
function matchMetric(text, patterns) {
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match)
            return normalizeText(match[1]);
    }
    return '0';
}
function looksLikeMetadata(line) {
    const text = normalizeText(line);
    if (!text)
        return true;
    if (text.startsWith('@'))
        return true;
    if (MEMBER_PATTERNS.some((pattern) => pattern.test(text)))
        return true;
    if (FOLLOWER_PATTERNS.some((pattern) => pattern.test(text)))
        return true;
    if (PRIVATE_PATTERNS.some((pattern) => pattern.test(text)))
        return true;
    if (/^(public|pinned)$/i.test(text))
        return true;
    if (/^(lists?|你的列表)$/i.test(text))
        return true;
    return false;
}
export function parseListCards(cards) {
    const seen = new Set();
    const results = [];
    for (const card of cards || []) {
        const href = normalizeText(card?.href);
        const rawText = String(card?.text || '');
        if (!href || seen.has(href))
            continue;
        seen.add(href);
        const text = normalizeText(rawText);
        if (!text)
            continue;
        const lines = rawText
            .split('\n')
            .map((line) => normalizeText(line))
            .filter(Boolean);
        const name = lines.find((line) => !looksLikeMetadata(line));
        if (!name)
            continue;
        results.push({
            name,
            members: matchMetric(text, MEMBER_PATTERNS),
            followers: matchMetric(text, FOLLOWER_PATTERNS),
            mode: PRIVATE_PATTERNS.some((pattern) => pattern.test(text)) ? 'private' : 'public',
        });
    }
    return results;
}
export function isEmptyListsState(text) {
    const normalized = normalizeText(text);
    return EMPTY_STATE_PATTERNS.some((pattern) => pattern.test(normalized));
}
