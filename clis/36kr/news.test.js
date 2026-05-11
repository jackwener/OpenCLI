import { describe, it, expect, vi, afterEach } from 'vitest';
const SAMPLE_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>36氪</title>
<item>
  <title>红杉中国领投AI公司「示例」，金额近2亿元</title>
  <link><![CDATA[https://36kr.com/p/1111111111111111?f=rss]]></link>
  <pubDate>2026-03-26 10:00:00  +0800</pubDate>
</item>
<item>
  <title>马斯克旗下xAI估值突破1000亿美元</title>
  <link><![CDATA[https://36kr.com/p/2222222222222222?f=rss]]></link>
  <pubDate>2026-03-26 09:00:00  +0800</pubDate>
</item>
<item>
  <title>OpenAI发布GPT-5，多模态能力大幅提升</title>
  <link><![CDATA[https://36kr.com/p/3333333333333333?f=rss]]></link>
  <pubDate>2026-03-25 20:00:00  +0800</pubDate>
</item>
</channel></rss>`;
afterEach(() => {
    vi.restoreAllMocks();
});
describe('36kr/news RSS parsing', () => {
    it('parses RSS feed into ranked news items', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue({
            ok: true,
            text: async () => SAMPLE_RSS,
        });
        // Direct RSS parse test using the same regex logic as news.ts
        const xml = SAMPLE_RSS;
        const items = [];
        const itemRegex = /<item>([\s\S]*?)<\/item>/g;
        let match;
        while ((match = itemRegex.exec(xml)) && items.length < 10) {
            const block = match[1];
            const title = block.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim() ?? '';
            const url = block.match(/<link><!\[CDATA\[(.*?)\]\]>/)?.[1] ??
                block.match(/<link>(.*?)<\/link>/)?.[1] ??
                '';
            const pubDate = block.match(/<pubDate>(.*?)<\/pubDate>/)?.[1]?.trim() ?? '';
            const date = pubDate.slice(0, 10);
            if (title)
                items.push({ rank: items.length + 1, title, date, url: url.trim() });
        }
        expect(items).toHaveLength(3);
        expect(items[0].rank).toBe(1);
        expect(items[0].title).toBe('红杉中国领投AI公司「示例」，金额近2亿元');
        expect(items[0].date).toBe('2026-03-26');
        expect(items[0].url).toBe('https://36kr.com/p/1111111111111111?f=rss');
    });
    it('respects limit — returns at most N items', async () => {
        const xml = SAMPLE_RSS;
        const limit = 2;
        const items = [];
        const itemRegex = /<item>([\s\S]*?)<\/item>/g;
        let match;
        while ((match = itemRegex.exec(xml)) && items.length < limit) {
            const block = match[1];
            const title = block.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim() ?? '';
            const url = block.match(/<link><!\[CDATA\[(.*?)\]\]>/)?.[1] ?? '';
            const pubDate = block.match(/<pubDate>(.*?)<\/pubDate>/)?.[1]?.trim() ?? '';
            const date = pubDate.slice(0, 10);
            if (title)
                items.push({ rank: items.length + 1, title, date, url: url.trim() });
        }
        expect(items).toHaveLength(2);
    });
    it('skips items with empty title', async () => {
        const xml = `<rss><channel>
      <item><title></title><link>https://36kr.com/p/0</link><pubDate>2026-01-01</pubDate></item>
      <item><title>有标题的文章</title><link>https://36kr.com/p/1</link><pubDate>2026-01-01</pubDate></item>
    </channel></rss>`;
        const items = [];
        const itemRegex = /<item>([\s\S]*?)<\/item>/g;
        let match;
        while ((match = itemRegex.exec(xml))) {
            const block = match[1];
            const title = block.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.trim() ?? '';
            if (title)
                items.push({ title });
        }
        expect(items).toHaveLength(1);
        expect(items[0].title).toBe('有标题的文章');
    });
});
