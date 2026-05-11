import { describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { normalizeArxivCategory, normalizeArxivLimit, parseEntries } from './utils.js';
import './paper.js';
import './search.js';
import './recent.js';

const SAMPLE_ENTRY_XML = `<?xml version='1.0' encoding='UTF-8'?>
<feed xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/"
      xmlns:arxiv="http://arxiv.org/schemas/atom"
      xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/1706.03762v7</id>
    <title>Attention Is All You Need &amp; Friends</title>
    <updated>2023-08-02T00:41:18Z</updated>
    <link href="https://arxiv.org/abs/1706.03762v7" rel="alternate" type="text/html"/>
    <link href="https://arxiv.org/pdf/1706.03762v7" rel="related" type="application/pdf" title="pdf"/>
    <summary>The dominant sequence transduction models are based on complex recurrent or convolutional neural networks. We propose a new simple network architecture, the Transformer, based solely on attention.</summary>
    <category term="cs.CL" scheme="http://arxiv.org/schemas/atom"/>
    <category term="cs.LG" scheme="http://arxiv.org/schemas/atom"/>
    <published>2017-06-12T17:57:34Z</published>
    <arxiv:comment>15 pages, 5 figures</arxiv:comment>
    <arxiv:primary_category term="cs.CL"/>
    <author><name>Ashish Vaswani</name></author>
    <author><name>Noam Shazeer</name></author>
    <author><name>Niki Parmar</name></author>
    <author><name>Jakob Uszkoreit</name></author>
    <author><name>Llion Jones</name></author>
    <author><name>Aidan N. Gomez</name></author>
    <author><name>Lukasz Kaiser</name></author>
    <author><name>Illia Polosukhin</name></author>
  </entry>
</feed>`;

describe('arxiv adapter', () => {
  it('registers paper, search and recent commands with the expected columns', () => {
    const paper = getRegistry().get('arxiv/paper');
    const search = getRegistry().get('arxiv/search');
    const recent = getRegistry().get('arxiv/recent');

    expect(paper).toBeDefined();
    expect(search).toBeDefined();
    expect(recent).toBeDefined();

    expect(paper.columns).toEqual([
      'id', 'title', 'authors', 'published', 'updated',
      'primary_category', 'categories', 'abstract', 'comment', 'pdf', 'url',
    ]);
    expect(search.columns).toEqual([
      'id', 'title', 'authors', 'published', 'primary_category', 'url',
    ]);
    expect(recent.columns).toEqual([
      'id', 'title', 'authors', 'published', 'primary_category', 'url',
    ]);
  });

  it('parseEntries returns full abstract, all authors, pdf, primary category and comment', () => {
    const [entry] = parseEntries(SAMPLE_ENTRY_XML);

    expect(entry.id).toBe('1706.03762');
    expect(entry.title).toBe('Attention Is All You Need & Friends');
    // All 8 authors must be present — earlier impl truncated to 3.
    expect(entry.authors.split(', ')).toHaveLength(8);
    expect(entry.authors).toContain('Ashish Vaswani');
    expect(entry.authors).toContain('Illia Polosukhin');
    // Full abstract — earlier impl truncated at 200 chars.
    expect(entry.abstract.length).toBeGreaterThan(140);
    expect(entry.abstract.endsWith('...')).toBe(false);
    expect(entry.abstract).toContain('attention');
    expect(entry.published).toBe('2017-06-12');
    expect(entry.updated).toBe('2023-08-02');
    expect(entry.primary_category).toBe('cs.CL');
    expect(entry.categories).toBe('cs.CL, cs.LG');
    expect(entry.comment).toBe('15 pages, 5 figures');
    expect(entry.pdf).toBe('https://arxiv.org/pdf/1706.03762v7');
    expect(entry.url).toBe('https://arxiv.org/abs/1706.03762');
  });

  it('parseEntries returns an empty list for feeds with no entries', () => {
    expect(parseEntries('<feed></feed>')).toEqual([]);
  });

  it('recent rejects malformed category strings', async () => {
    const recent = getRegistry().get('arxiv/recent');
    await expect(recent.func({ category: 'not a category', limit: 5 })).rejects.toMatchObject({
      code: 'ARGUMENT',
    });
    await expect(recent.func({ category: '', limit: 5 })).rejects.toMatchObject({
      code: 'ARGUMENT',
    });
  });

  it('category validation accepts real arXiv archive and subcategory forms', () => {
    expect(normalizeArxivCategory('cs.CL')).toBe('cs.CL');
    expect(normalizeArxivCategory('math')).toBe('math');
    expect(normalizeArxivCategory('physics.comp-ph')).toBe('physics.comp-ph');
    expect(normalizeArxivCategory('physics.data-an')).toBe('physics.data-an');
    expect(normalizeArxivCategory('cond-mat.soft')).toBe('cond-mat.soft');
    expect(normalizeArxivCategory('q-bio.NC')).toBe('q-bio.NC');
    expect(() => normalizeArxivCategory('not a category')).toThrow('Invalid arXiv category');
    expect(() => normalizeArxivCategory('cs/CL')).toThrow('Invalid arXiv category');
    expect(() => normalizeArxivCategory('')).toThrow('Invalid arXiv category');
  });

  it('limit validation rejects non-positive, non-integer and over-cap values', () => {
    expect(normalizeArxivLimit(10, 5, 25)).toBe(10);
    expect(normalizeArxivLimit(undefined, 5, 25)).toBe(5);
    expect(() => normalizeArxivLimit(0, 5, 25)).toThrow('positive integer');
    expect(() => normalizeArxivLimit(1.5, 5, 25)).toThrow('positive integer');
    expect(() => normalizeArxivLimit(26, 5, 25)).toThrow('<= 25');
  });
});
