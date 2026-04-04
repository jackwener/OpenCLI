/**
 * Google adapter utilities.
 * Shared RSS parser for news and trends commands.
 */

/**
 * Parse RSS XML by splitting into <item> blocks, then extracting fields per block.
 * Handles both plain text and CDATA-wrapped content.
 */
export function parseRssItems(xml: string, fields: string[]): Record<string, string>[] {
  const items = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
  return items.map(block => {
    const record: Record<string, string> = {};
    for (const field of fields) {
      // Escape regex special characters in field name (e.g. ht:approx_traffic is safe, but defensive)
      const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Handle tags with attributes (e.g. <source url="...">text</source>) and CDATA wrapping
      // (?:\s[^>]*)? ensures we don't match prefix tags (e.g. <sourceUrl> when looking for <source>)
      const match = block.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${escaped}>`));
      record[field] = match ? match[1].trim() : '';
    }
    return record;
  });
}
