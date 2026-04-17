import { describe, it, expect } from 'vitest';
import { parseRssItems } from './utils.js';
describe('parseRssItems', () => {
    it('extracts plain text fields', () => {
        const xml = `
      <channel>
        <item><title>Hello</title><link>https://example.com</link></item>
        <item><title>World</title><link>https://test.com</link></item>
      </channel>
    `;
        const items = parseRssItems(xml, ['title', 'link']);
        expect(items).toEqual([
            { title: 'Hello', link: 'https://example.com' },
            { title: 'World', link: 'https://test.com' },
        ]);
    });
    it('handles CDATA-wrapped content', () => {
        const xml = `
      <item><title><![CDATA[Breaking News]]></title><link>https://news.com</link></item>
    `;
        const items = parseRssItems(xml, ['title', 'link']);
        expect(items).toEqual([
            { title: 'Breaking News', link: 'https://news.com' },
        ]);
    });
    it('handles namespaced fields like ht:approx_traffic', () => {
        const xml = `
      <item>
        <title>AI</title>
        <ht:approx_traffic>500,000+</ht:approx_traffic>
        <pubDate>Mon, 20 Mar 2026</pubDate>
      </item>
    `;
        const items = parseRssItems(xml, ['title', 'ht:approx_traffic', 'pubDate']);
        expect(items).toEqual([
            { title: 'AI', 'ht:approx_traffic': '500,000+', pubDate: 'Mon, 20 Mar 2026' },
        ]);
    });
    it('returns empty string for missing fields', () => {
        const xml = `<item><title>Test</title></item>`;
        const items = parseRssItems(xml, ['title', 'missing']);
        expect(items).toEqual([{ title: 'Test', missing: '' }]);
    });
    it('handles tags with attributes (e.g. <source url="...">)', () => {
        const xml = `
      <item>
        <title><![CDATA[AI reshapes everything - Reuters]]></title>
        <source url="https://reuters.com">Reuters</source>
        <link>https://news.google.com/123</link>
      </item>
    `;
        const items = parseRssItems(xml, ['title', 'source', 'link']);
        expect(items).toEqual([
            { title: 'AI reshapes everything - Reuters', source: 'Reuters', link: 'https://news.google.com/123' },
        ]);
    });
    it('handles mixed CDATA and plain text in the same item', () => {
        const xml = `
      <item>
        <title><![CDATA[Breaking: Major event]]></title>
        <link>https://example.com/article</link>
        <pubDate>Fri, 21 Mar 2026</pubDate>
      </item>
    `;
        const items = parseRssItems(xml, ['title', 'link', 'pubDate']);
        expect(items).toEqual([
            { title: 'Breaking: Major event', link: 'https://example.com/article', pubDate: 'Fri, 21 Mar 2026' },
        ]);
    });
    it('returns empty array for no items', () => {
        const xml = `<channel><title>Empty</title></channel>`;
        const items = parseRssItems(xml, ['title']);
        expect(items).toEqual([]);
    });
});
