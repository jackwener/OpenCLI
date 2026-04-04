import { describe, expect, it } from 'vitest';
import { extractStoryMediaLinks, parseBloombergRss, renderStoryBody } from './utils.js';

describe('Bloomberg utils', () => {
  it('parses Bloomberg RSS items with summary, link, and deduped media links', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <rss xmlns:media="http://search.yahoo.com/mrss/">
        <channel>
          <item>
            <title><![CDATA[Headline One]]></title>
            <description><![CDATA[Summary <b>One</b> &amp; more]]></description>
            <link>https://www.bloomberg.com/news/articles/2026-03-19/example-one</link>
            <media:content url="https://assets.bwbx.io/example-one.jpg" type="image/jpeg">
              <media:thumbnail url="https://assets.bwbx.io/example-one.jpg" />
            </media:content>
          </item>
          <item>
            <title>Headline Two</title>
            <description>Summary Two</description>
            <guid isPermaLink="true">https://www.bloomberg.com/news/articles/2026-03-19/example-two</guid>
            <enclosure url="https://assets.bwbx.io/example-two.png" type="image/png" />
          </item>
        </channel>
      </rss>`;

    const items = parseBloombergRss(xml);
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      title: 'Headline One',
      summary: 'Summary One & more',
      link: 'https://www.bloomberg.com/news/articles/2026-03-19/example-one',
      mediaLinks: ['https://assets.bwbx.io/example-one.jpg'],
    });
    expect(items[1]).toEqual({
      title: 'Headline Two',
      summary: 'Summary Two',
      link: 'https://www.bloomberg.com/news/articles/2026-03-19/example-two',
      mediaLinks: ['https://assets.bwbx.io/example-two.png'],
    });
  });

  it('renders Bloomberg story rich-text body into readable text', () => {
    const body = {
      type: 'document',
      content: [
        { type: 'inline-newsletter', data: { position: 'top' }, content: [] },
        {
          type: 'paragraph',
          data: {},
          content: [
            { type: 'text', value: 'Lead paragraph with ' },
            { type: 'entity', content: [{ type: 'text', value: 'linked text' }] },
            { type: 'text', value: '.' },
          ],
        },
        {
          type: 'heading',
          data: { level: 2 },
          content: [{ type: 'text', value: 'Key Points' }],
        },
        {
          type: 'list',
          data: { style: 'unordered' },
          content: [
            {
              type: 'list-item',
              content: [
                { type: 'paragraph', content: [{ type: 'text', value: 'Point one' }] },
              ],
            },
            {
              type: 'list-item',
              content: [
                { type: 'paragraph', content: [{ type: 'text', value: 'Point two' }] },
              ],
            },
          ],
        },
        {
          type: 'blockquote',
          content: [{ type: 'text', value: 'Quoted line' }],
        },
        {
          type: 'media',
          data: {
            attachment: {
              caption: '<p>Chart caption</p>',
            },
          },
        },
        { type: 'ad', data: { num: 1 }, content: [] },
      ],
    };

    expect(renderStoryBody(body)).toBe([
      'Lead paragraph with linked text.',
      '## Key Points',
      '- Point one\n- Point two',
      '> Quoted line',
      'Chart caption',
    ].join('\n\n'));
  });

  it('collects deduped story media links from lede, attachments, and body media', () => {
    const story = {
      ledeImageUrl: 'https://assets.bwbx.io/lede.webp',
      lede: { url: 'https://assets.bwbx.io/lede.webp' },
      socialImageUrl: 'https://assets.bwbx.io/social.png',
      imageAttachments: {
        one: { url: 'https://assets.bwbx.io/figure.jpg' },
      },
      body: {
        content: [
          {
            type: 'media',
            data: {
              chart: {
                src: 'https://resource.bloomberg.com/images/chart.png',
                fallback: 'https://assets.bwbx.io/chart-fallback.png',
              },
            },
          },
        ],
      },
    };

    expect(extractStoryMediaLinks(story)).toEqual([
      'https://assets.bwbx.io/lede.webp',
      'https://assets.bwbx.io/social.png',
      'https://assets.bwbx.io/figure.jpg',
      'https://resource.bloomberg.com/images/chart.png',
      'https://assets.bwbx.io/chart-fallback.png',
    ]);
  });
});
