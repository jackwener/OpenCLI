/**
 * Product Hunt shared helpers.
 */
export const PRODUCTHUNT_CATEGORY_SLUGS = [
    'ai-agents',
    'ai-coding-agents',
    'ai-code-editors',
    'ai-chatbots',
    'ai-workflow-automation',
    'vibe-coding',
    'developer-tools',
    'productivity',
    'design-creative',
    'marketing-sales',
    'no-code-platforms',
    'llms',
    'finance',
    'social-community',
    'engineering-development',
];
const UA = 'Mozilla/5.0 (compatible; opencli/1.0)';
/**
 * Fetch Product Hunt Atom RSS feed.
 * @param category  Optional category slug (e.g. "ai", "developer-tools")
 */
export async function fetchFeed(category) {
    const url = category
        ? `https://www.producthunt.com/feed?category=${encodeURIComponent(category)}`
        : 'https://www.producthunt.com/feed';
    const resp = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!resp.ok)
        return [];
    const xml = await resp.text();
    return parseFeed(xml);
}
export function parseFeed(xml) {
    const posts = [];
    const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
    let match;
    let rank = 1;
    while ((match = entryRegex.exec(xml))) {
        const block = match[1];
        const name = block.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim() ?? '';
        const author = block.match(/<name>([\s\S]*?)<\/name>/)?.[1]?.trim() ?? '';
        const pubRaw = block.match(/<published>(.*?)<\/published>/)?.[1]?.trim() ?? '';
        const date = pubRaw.slice(0, 10);
        const link = block.match(/<link[^>]*href="([^"]+)"/)?.[1]?.trim() ?? '';
        // Extract tagline from HTML content (first <p> text)
        const contentRaw = block.match(/<content[^>]*>([\s\S]*?)<\/content>/)?.[1] ?? '';
        const contentDecoded = contentRaw
            .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
        const tagline = contentDecoded
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .replace(/\s*Discussion\s*\|?\s*/gi, '')
            .replace(/\s*\|?\s*Link\s*$/gi, '')
            .trim()
            .slice(0, 120);
        if (name) {
            posts.push({ rank: rank++, name, tagline, author, date, url: link });
        }
    }
    return posts;
}
export function pickVoteCount(candidates) {
    const scored = candidates
        .map((candidate) => {
        const text = String(candidate.text ?? '').trim();
        if (!/^\d+$/.test(text))
            return null;
        if (candidate.inReviewLink)
            return null;
        const value = parseInt(text, 10);
        if (!Number.isFinite(value) || value <= 0)
            return null;
        const signal = `${candidate.tagName ?? ''} ${candidate.className ?? ''} ${candidate.role ?? ''}`.toLowerCase();
        let score = 0;
        if (candidate.inButton)
            score += 4;
        if (signal.includes('vote') || signal.includes('upvote'))
            score += 3;
        if (signal.includes('button'))
            score += 1;
        return { text, score, value };
    })
        .filter((candidate) => Boolean(candidate))
        .sort((a, b) => {
        if (b.score !== a.score)
            return b.score - a.score;
        if (b.value !== a.value)
            return b.value - a.value;
        return a.text.localeCompare(b.text);
    });
    return scored[0]?.text ?? '';
}
/** Format ISO date string to YYYY-MM-DD */
export function toDate(iso) {
    return iso.slice(0, 10);
}
