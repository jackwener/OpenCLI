/**
 * arXiv adapter utilities.
 *
 * arXiv exposes a public Atom/XML API — no key required.
 * https://info.arxiv.org/help/api/index.html
 */

import { CliError } from '../../src/errors.js';

export const ARXIV_BASE = 'https://export.arxiv.org/api/query';

export async function arxivFetch(params: string): Promise<string> {
  const resp = await fetch(`${ARXIV_BASE}?${params}`);
  if (!resp.ok) {
    throw new CliError('FETCH_ERROR', `arXiv API HTTP ${resp.status}`, 'Check your search term or paper ID');
  }
  return resp.text();
}

/** Extract the text content of the first matching XML tag. */
function extract(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  return m ? m[1].trim() : '';
}

/** Extract all text contents of a repeated XML tag. */
function extractAll(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'g');
  const results: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) results.push(m[1].trim());
  return results;
}

export interface ArxivEntry {
  id: string;
  title: string;
  authors: string;
  abstract: string;
  published: string;
  url: string;
}

/** Parse Atom XML feed into structured entries. */
export function parseEntries(xml: string): ArxivEntry[] {
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
  const entries: ArxivEntry[] = [];
  let m: RegExpExecArray | null;
  while ((m = entryRe.exec(xml)) !== null) {
    const e = m[1];
    const rawId = extract(e, 'id');
    const arxivId = rawId.replace(/^https?:\/\/arxiv\.org\/abs\//, '').replace(/v\d+$/, '');
    entries.push({
      id: arxivId,
      title: extract(e, 'title').replace(/\s+/g, ' '),
      authors: extractAll(e, 'name').slice(0, 3).join(', '),
      abstract: (() => { const s = extract(e, 'summary').replace(/\s+/g, ' '); return s.length > 200 ? s.slice(0, 200) + '...' : s; })(),
      published: extract(e, 'published').slice(0, 10),
      url: `https://arxiv.org/abs/${arxivId}`,
    });
  }
  return entries;
}
