/**
 * Product Hunt shared helpers.
 */

export interface PhPost {
  rank: number;
  name: string;
  tagline: string;
  author: string;
  date: string;
  url: string;
}

const UA = 'Mozilla/5.0 (compatible; opencli/1.0)';

/**
 * Fetch Product Hunt Atom RSS feed.
 * @param category  Optional category slug (e.g. "ai", "developer-tools")
 */
export async function fetchFeed(category?: string): Promise<PhPost[]> {
  const url = category
    ? `https://www.producthunt.com/feed?category=${encodeURIComponent(category)}`
    : 'https://www.producthunt.com/feed';

  const resp = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!resp.ok) return [];
  const xml = await resp.text();
  return parseFeed(xml);
}

export function parseFeed(xml: string): PhPost[] {
  const posts: PhPost[] = [];
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

/** Format ISO date string to YYYY-MM-DD */
export function toDate(iso: string): string {
  return iso.slice(0, 10);
}
