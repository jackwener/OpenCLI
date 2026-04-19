/**
 * Utility functions for 99csw.com adapter
 */

/**
 * Extract chapter list from book index page HTML
 */
export function extractChapters(html) {
  const chapters = [];

  // Match links with pattern: /book/BOOKID/CHAPTERID.htm (handles both quoted and unquoted href)
  const regex = /href=["']?\/book\/\d+\/(\d+)\.htm["']?[^>]*>([^<]+)<\/a>/g;
  let match;

  while ((match = regex.exec(html)) !== null) {
    const id = match[1];
    const title = match[2].trim();

    // Skip navigation links and other non-chapter links
    if (title && !title.includes('更多') && id !== '0') {
      chapters.push({ id, title });
    }
  }

  // Remove duplicates (links appear multiple times)
  const seen = new Set();
  return chapters.filter(ch => {
    if (seen.has(ch.id)) return false;
    seen.add(ch.id);
    return true;
  });
}

/**
 * Extract book metadata from index page HTML
 */
export function extractBookMetadata(html) {
  const metadata = {};

  // Extract title
  const titleMatch = html.match(/<h\d[^>]*>([^<]+)<\/h\d>/);
  if (titleMatch) metadata.title = titleMatch[1].trim();

  // Extract author
  const authorMatch = html.match(/作者[：:]*([^<\n]+)/);
  if (authorMatch) metadata.author = authorMatch[1].trim();

  // Extract translator
  const translatorMatch = html.match(/翻译[：:]*([^<\n]+)/);
  if (translatorMatch) metadata.translator = translatorMatch[1].trim();

  return metadata;
}

/**
 * Extract chapter content from chapter page HTML
 */
export function extractChapterContent(html) {
  const content = {};

  // Extract chapter title
  const titleMatch = html.match(/<h\d[^>]*>([^<]+)<\/h\d>/);
  if (titleMatch) content.title = titleMatch[1].trim();

  // Extract main content - look for common content containers
  let bodyMatch;

  // Try to find content in common div patterns
  bodyMatch = html.match(/<div[^>]*class="[^"]*(?:content|main|body|text)[^"]*"[^>]*>([\s\S]*?)<\/div>/i);

  if (!bodyMatch) {
    // Fallback: try to find content between heading and footer
    bodyMatch = html.match(/<h\d[^>]*>[^<]*<\/h\d>([\s\S]*?)(?:<div[^>]*class="[^"]*(?:comment|note|footer)[^"]*"|<\/main>|$)/i);
  }

  if (bodyMatch) {
    let body = bodyMatch[1];

    // Clean HTML tags but keep basic text structure
    body = body
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '') // Remove scripts
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '') // Remove styles
      .replace(/<[^>]+>/g, '') // Remove all other tags
      .replace(/&nbsp;/g, ' ') // Convert nbsp
      .replace(/&lt;/g, '<')   // Decode entities
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')   // Normalize whitespace
      .trim();

    content.body = body;
  }

  return content;
}

/**
 * Parse book and chapter IDs from URL
 */
export function parseBookChapterId(url) {
  const match = url.match(/\/book\/(\d+)(?:\/(\d+))?\.htm/);
  if (!match) throw new Error(`Invalid 99csw.com URL: ${url}`);

  return {
    bookId: match[1],
    chapterId: match[2],
  };
}

