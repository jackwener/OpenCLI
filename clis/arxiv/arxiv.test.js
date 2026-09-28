import { describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import {
    normalizeArxivCategory,
    normalizeArxivId,
    normalizeArxivLimit,
    parseBibtexEntry,
    parseEntries,
    parseTotalResults,
    resolveSubmittedRange,
} from './utils.js';
import './paper.js';
import './search.js';
import './recent.js';
import './since.js';
import './bibtex.js';
import './pdf.js';

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

const BIBTEX_SAMPLE = [
  '@misc{vaswani2023attentionneed,',
  '      title={Attention Is All You Need}, ',
  '      author={Ashish Vaswani and Noam Shazeer},',
  '      year={2023},',
  '      eprint={1706.03762},',
  '      archivePrefix={arXiv},',
  '      primaryClass={cs.CL},',
  '      url={https://arxiv.org/abs/1706.03762}, ',
  '}',
].join('\n');

describe('arxiv since / bibtex / pdf', () => {
  it('registers since, bibtex and pdf with the expected columns', () => {
    const since = getRegistry().get('arxiv/since');
    const bibtex = getRegistry().get('arxiv/bibtex');
    const pdf = getRegistry().get('arxiv/pdf');
    expect(since).toBeDefined();
    expect(bibtex).toBeDefined();
    expect(pdf).toBeDefined();
    expect(since.columns).toEqual(['id', 'title', 'authors', 'published', 'primary_category', 'url']);
    expect(bibtex.columns).toEqual(['id', 'cite_key', 'title', 'authors', 'year', 'primary_class', 'bibtex', 'url']);
    expect(pdf.columns).toEqual(['id', 'status', 'size', 'bytes', 'path', 'url']);
  });

  it('resolveSubmittedRange defaults to the last 7 calendar days including today', () => {
    const range = resolveSubmittedRange({ now: Date.parse('2026-09-28T13:00:00Z') });
    expect(range.from).toBe('202609220000');
    expect(range.to).toBe('202609282359');
    expect(range.fromDate).toBe('2026-09-22');
    expect(range.toDate).toBe('2026-09-28');
    expect(range.range).toBe('submittedDate:[202609220000 TO 202609282359]');
  });

  it('resolveSubmittedRange counts --days 1 as today only', () => {
    const range = resolveSubmittedRange({ days: 1, now: Date.parse('2026-09-28T00:30:00Z') });
    expect(range.from).toBe('202609280000');
    expect(range.to).toBe('202609282359');
  });

  it('resolveSubmittedRange honours an explicit --from/--to window', () => {
    const range = resolveSubmittedRange({
      from: '2026-09-20',
      to: '2026-09-27',
      now: Date.parse('2026-09-28T00:00:00Z'),
    });
    expect(range.from).toBe('202609200000');
    expect(range.to).toBe('202609272359');
  });

  it('resolveSubmittedRange treats a lone --to as that single day', () => {
    const range = resolveSubmittedRange({ to: '2026-09-25', now: Date.parse('2026-09-28T00:00:00Z') });
    expect(range.from).toBe('202609250000');
    expect(range.to).toBe('202609252359');
  });

  it('resolveSubmittedRange rejects conflicting or impossible windows', () => {
    expect(() => resolveSubmittedRange({ days: 3, from: '2026-09-01' })).toThrow('not both');
    expect(() => resolveSubmittedRange({ from: '2026-09-27', to: '2026-09-20' })).toThrow('must not be after');
    expect(() => resolveSubmittedRange({ from: '2026/09/20' })).toThrow('YYYY-MM-DD');
    expect(() => resolveSubmittedRange({ from: '2026-02-31' })).toThrow('not a real calendar date');
    expect(() => resolveSubmittedRange({ days: 0 })).toThrow('positive integer');
  });

  it('normalizeArxivId accepts new, versioned and legacy IDs and rejects junk', () => {
    expect(normalizeArxivId('1706.03762')).toBe('1706.03762');
    expect(normalizeArxivId('1706.03762v7')).toBe('1706.03762v7');
    expect(normalizeArxivId('cs/0701001')).toBe('cs/0701001');
    expect(normalizeArxivId('hep-th/9901001')).toBe('hep-th/9901001');
    expect(() => normalizeArxivId('not-an-id')).toThrow('Invalid arXiv ID');
    expect(() => normalizeArxivId('')).toThrow('Invalid arXiv ID');
  });

  it('parseTotalResults reads the opensearch match count', () => {
    expect(parseTotalResults('<feed><opensearch:totalResults>1980</opensearch:totalResults></feed>')).toBe(1980);
    expect(parseTotalResults('<feed></feed>')).toBe(0);
  });

  it('parseBibtexEntry returns the cite key and normalised fields', () => {
    const parsed = parseBibtexEntry(BIBTEX_SAMPLE);
    expect(parsed.entryType).toBe('misc');
    expect(parsed.citeKey).toBe('vaswani2023attentionneed');
    expect(parsed.fields.eprint).toBe('1706.03762');
    expect(parsed.fields.primaryclass).toBe('cs.CL');
    expect(parsed.fields.author).toContain('Ashish Vaswani');
    expect(parseBibtexEntry('not bibtex at all')).toBeNull();
  });
});

