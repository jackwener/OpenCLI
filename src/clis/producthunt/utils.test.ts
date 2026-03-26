import { describe, it, expect } from 'vitest';
import { parseFeed, pickVoteCount, PRODUCTHUNT_CATEGORY_SLUGS } from './utils.js';

const SAMPLE_ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Product Hunt</title>
  <entry>
    <id>tag:www.producthunt.com,2005:Post/1001</id>
    <published>2026-03-26T10:00:00-07:00</published>
    <title>Awesome AI Tool</title>
    <content type="html">&lt;p&gt;The best AI tool ever made&lt;/p&gt;&lt;p&gt;&lt;a href="..."&gt;Discussion&lt;/a&gt;&lt;/p&gt;</content>
    <author><name>Jane Doe</name></author>
    <link rel="alternate" type="text/html" href="https://www.producthunt.com/products/awesome-ai-tool"/>
  </entry>
  <entry>
    <id>tag:www.producthunt.com,2005:Post/1002</id>
    <published>2026-03-25T08:00:00-07:00</published>
    <title>Dev Helper</title>
    <content type="html">&lt;p&gt;Speeds up your workflow&lt;/p&gt;</content>
    <author><name>John Smith</name></author>
    <link rel="alternate" type="text/html" href="https://www.producthunt.com/products/dev-helper"/>
  </entry>
</feed>`;

describe('parseFeed', () => {
  it('parses entries into ranked posts', () => {
    const posts = parseFeed(SAMPLE_ATOM);
    expect(posts).toHaveLength(2);
    expect(posts[0].rank).toBe(1);
    expect(posts[0].name).toBe('Awesome AI Tool');
    expect(posts[0].author).toBe('Jane Doe');
    expect(posts[0].date).toBe('2026-03-26');
    expect(posts[0].url).toBe('https://www.producthunt.com/products/awesome-ai-tool');
    expect(posts[0].tagline).toContain('best AI tool');
  });

  it('strips HTML and Discussion link from tagline', () => {
    const posts = parseFeed(SAMPLE_ATOM);
    expect(posts[0].tagline).not.toContain('<p>');
    expect(posts[0].tagline).not.toContain('Discussion');
  });

  it('returns empty array for empty feed', () => {
    expect(parseFeed('<feed></feed>')).toHaveLength(0);
  });

  it('assigns sequential ranks', () => {
    const posts = parseFeed(SAMPLE_ATOM);
    expect(posts.map(p => p.rank)).toEqual([1, 2]);
  });

  it('prefers vote-like candidates over unrelated numeric badges', () => {
    const votes = pickVoteCount([
      { text: '12', className: 'font-semibold', inButton: false, inReviewLink: false },
      { text: '98', className: 'vote-button', inButton: true, inReviewLink: false },
    ]);
    expect(votes).toBe('98');
  });

  it('ignores numbers inside review links', () => {
    const votes = pickVoteCount([
      { text: '120', className: 'text-secondary', inButton: false, inReviewLink: true },
      { text: '45', className: 'vote-button', inButton: true, inReviewLink: false },
    ]);
    expect(votes).toBe('45');
  });

  it('shares category slugs across commands', () => {
    expect(PRODUCTHUNT_CATEGORY_SLUGS).toContain('developer-tools');
    expect(PRODUCTHUNT_CATEGORY_SLUGS).toContain('ai-agents');
  });
});
