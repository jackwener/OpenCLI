import { ArgumentError } from '@jackwener/opencli/errors';

export function normalizeCnkiUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith('//')) return `https:${raw}`;
  if (raw.startsWith('/')) return `https://kns.cnki.net${raw}`;
  return `https://kns.cnki.net/${raw}`;
}

export function cnkiSearchUrl(query) {
  const params = new URLSearchParams({
    rc: 'CJFQ',
    kw: query,
    rt: 'journal',
    fd: 'SU$%=|',
  });
  return `https://kns.cnki.net/starter?${params.toString()}`;
}

export const detailExtractor = String.raw`
  (() => {
    const normalize = v => (v || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const clean = v => normalize(v)
      .replace(/^(?:\u6458\u8981|\u4e2d\u6587\u6458\u8981|Abstract)[:\uff1a\s]*/i, '')
      .replace(/^(?:\u5173\u952e\u8bcd|Keywords)[:\uff1a\s]*/i, '')
      .trim();
    const pick = selectors => {
      for (const selector of selectors) {
        for (const el of document.querySelectorAll(selector)) {
          const text = clean(el.innerText || el.textContent);
          if (text) return text;
        }
      }
      return '';
    };
    const pickAttr = (selectors, attr) => {
      for (const selector of selectors) {
        for (const el of document.querySelectorAll(selector)) {
          const text = clean(el.getAttribute(attr));
          if (text) return text;
        }
      }
      return '';
    };
    const meta = names => {
      for (const name of names) {
        const value = pickAttr([
          'meta[name="' + name + '"]',
          'meta[property="' + name + '"]',
          'meta[name="' + name.toLowerCase() + '"]',
          'meta[property="' + name.toLowerCase() + '"]',
        ], 'content');
        if (value) return value;
      }
      return '';
    };
    const stripTail = value => clean(value)
      .replace(/\s*\u67e5\u770b.*$/, '')
      .replace(/\s*View.*$/, '')
      .trim();
    const textAfterLabel = labels => {
      const nodes = Array.from(document.querySelectorAll('p, li, dd, div, section, span'));
      for (const el of nodes) {
        const text = normalize(el.innerText || el.textContent);
        if (!text || text.length < 4 || text.length > 5000) continue;
        for (const label of labels) {
          const direct = new RegExp('^(?:' + label + ')\\s*[:\\uff1a]?\\s*(.+)$', 'i');
          const match = text.match(direct);
          if (match?.[1]) return clean(match[1]);
        }
      }
      return '';
    };
    const labelValue = labels => {
      const stopLabels = [
        '\\u6458\\u8981', '\\u5173\\u952e\\u8bcd', '\\u4e13\\u8f91',
        '\\u4e13\\u9898', '\\u5206\\u7c7b\\u53f7',
        '\\u5728\\u7ebf\\u516c\\u5f00\\u65f6\\u95f4', '\\u57fa\\u91d1',
        '\\u4f5c\\u8005', '\\u6765\\u6e90', 'DOI', 'CLC', 'Fund'
      ];
      const nodes = Array.from(document.querySelectorAll('p, li, dd, div, section, span'))
        .sort((a, b) => normalize(a.innerText || a.textContent).length - normalize(b.innerText || b.textContent).length);
      for (const el of nodes) {
        const text = normalize(el.innerText || el.textContent);
        if (!text || text.length < 4 || text.length > 1200) continue;
        for (const label of labels) {
          const others = stopLabels.filter(item => item !== label).join('|');
          const pattern = new RegExp(label + '\\s*[:\\uff1a]\\s*(.+?)(?=\\s*(?:' + others + ')\\s*[:\\uff1a]|$)', 'i');
          const match = text.match(pattern);
          if (match?.[1]) return clean(match[1]);
        }
      }
      return '';
    };
    const parseSource = source => {
      const parsed = { journal: source, year: '', volume: '', issue: '', pages: '', startPage: '', endPage: '' };
      const text = stripTail(source);
      const match = text.match(/^(.+?)\s*[.\uFF0E]\s*(\d{4})(?:\s*[,\uFF0C]?\s*(?:Vol\.?\s*)?(\d+)\s*)?(?:\s*\(([^)]+)\))?(?:\s*[:\uFF1A]\s*([A-Za-z0-9]+(?:\s*[-\u2013\u2014]\s*[A-Za-z0-9]+)?))?/i);
      if (match) {
        parsed.journal = clean(match[1]);
        parsed.year = match[2] || '';
        parsed.volume = match[3] || '';
        parsed.issue = match[4] || '';
        parsed.pages = normalize(match[5] || '');
      }
      const pageMatch = parsed.pages.match(/^([A-Za-z0-9]+)\s*[-\u2013\u2014]\s*([A-Za-z0-9]+)$/);
      if (pageMatch) {
        parsed.startPage = pageMatch[1];
        parsed.endPage = pageMatch[2];
      }
      return parsed;
    };
    const cleanAuthors = value => clean(value)
      .replace(/^(?:\u4f5c\u8005|Author)[:\uff1a\s]*/i, '')
      .replace(/([\u3400-\u9fff])\d+(?=[\u3400-\u9fff])/g, '$1;')
      .replace(/([\u3400-\u9fff])\d+(?=\s|$)/g, '$1')
      .replace(/\s+/g, '; ')
      .replace(/;{2,}/g, ';')
      .replace(/;\s*$/, '');
    const keywordText = pick([
      '.keywords',
      '.keyword',
      '.wxBaseinfo [class*=keyword]',
      '#ChDivKeyWord',
      '[id*=KeyWord]',
      '[class*=KeyWord]',
    ]) || textAfterLabel(['\\u5173\\u952e\\u8bcd', 'Keywords']);
    const abstract = pick([
      '#ChDivSummary',
      '#ChDivSummaryMore',
      '.abstract-text',
      '.abstract',
      '.brief',
      '.summary',
      '.wxBaseinfo [class*=abstract]',
      '.doc-abstract',
      '[id*=Summary]',
      '[class*=Summary]',
    ]) || textAfterLabel(['\\u6458\\u8981', '\\u4e2d\\u6587\\u6458\\u8981', 'Abstract']);
    const rawKeywords = keywordText
      .replace(/^(?:\u5173\u952e\u8bcd|Keywords)[:\uff1a\s]*/i, '')
      .split(/[;,;\uff1b\uff0c\u3001]/)
      .map(item => normalize(item))
      .filter(Boolean);
    const sourceClean = stripTail(
      pick(['.top-tip span', '.sourcename', '.source', '.wxBaseinfo [class*=source]'])
        .replace(/^(?:\u6765\u6e90|Source)[:\uff1a\s]*/i, '')
    );
    const parsedSource = parseSource(sourceClean);
    const onlinePublishedAt = labelValue(['\\u5728\\u7ebf\\u516c\\u5f00\\u65f6\\u95f4']);
    const date = pick(['.year', '.date', '.publish-date', '.wxBaseinfo [class*=date]'])
      .replace(/^(?:\u53d1\u8868\u65f6\u95f4|\u65e5\u671f|Date)[:\uff1a\s]*/i, '')
      || meta(['citation_publication_date', 'citation_date', 'dc.date'])
      || (onlinePublishedAt.match(/\d{4}-\d{2}-\d{2}/)?.[0] || '');
    const doi = meta(['citation_doi', 'dc.identifier', 'DC.Identifier']) || labelValue(['DOI']);
    const classification = labelValue(['\\u5206\\u7c7b\\u53f7', 'CLC']);
    const album = labelValue(['\\u4e13\\u8f91']);
    const subject = labelValue(['\\u4e13\\u9898']);
    const fund = labelValue(['\\u57fa\\u91d1', 'Fund']);
    const year = parsedSource.year || meta(['citation_year']) || (date.match(/\d{4}/)?.[0] || '');
    const pages = meta(['citation_pages']) || parsedSource.pages;
    const startPage = meta(['citation_firstpage']) || parsedSource.startPage;
    const endPage = meta(['citation_lastpage']) || parsedSource.endPage;
    const url = new URL(location.href);
    const cnkiId = url.searchParams.get('filename')
      || url.searchParams.get('FileName')
      || url.searchParams.get('dbname')
      || url.searchParams.get('DbName')
      || '';
    return {
      title: pick(['.wx-tit h1', 'h1', '#chTitle', '.title', '[class*=title]']) || meta(['citation_title', 'dc.title']),
      authors: cleanAuthors(pick(['.author', '.authors', '.wxBaseinfo [class*=author]', '[class*=author]']) || meta(['citation_author', 'dc.creator'])),
      journal: meta(['citation_journal_title']) || parsedSource.journal || sourceClean,
      source: sourceClean,
      date,
      year,
      volume: meta(['citation_volume']) || parsedSource.volume,
      issue: meta(['citation_issue']) || parsedSource.issue,
      pages,
      startPage,
      endPage,
      doi,
      classification,
      album,
      subject,
      fund,
      onlinePublishedAt,
      cnkiId,
      abstract,
      keywords: Array.from(new Set(rawKeywords)),
      url: location.href,
      titleText: normalize(document.title),
      verificationRequired: /\u5b89\u5168\u9a8c\u8bc1|verify/i.test(document.title) || !!document.querySelector('[src*="/verify/"], [href*="/verify/"]'),
    };
  })()
`;

export async function extractCnkiDetail(page, url) {
  const targetUrl = normalizeCnkiUrl(url);
  if (!targetUrl) throw new ArgumentError('Missing CNKI detail URL.');
  await page.goto(targetUrl, { waitUntil: 'none', settleMs: 1200 });
  await page.wait(2);
  const data = await page.evaluate(detailExtractor);
  return {
    title: data?.title || '',
    authors: data?.authors || '',
    journal: data?.journal || '',
    source: data?.source || '',
    date: data?.date || '',
    year: data?.year || '',
    volume: data?.volume || '',
    issue: data?.issue || '',
    pages: data?.pages || '',
    startPage: data?.startPage || '',
    endPage: data?.endPage || '',
    doi: data?.doi || '',
    classification: data?.classification || '',
    album: data?.album || '',
    subject: data?.subject || '',
    fund: data?.fund || '',
    onlinePublishedAt: data?.onlinePublishedAt || '',
    cnkiId: data?.cnkiId || '',
    abstract: data?.abstract || '',
    keywords: Array.isArray(data?.keywords) ? data.keywords : [],
    url: data?.url || targetUrl,
    verificationRequired: Boolean(data?.verificationRequired),
  };
}


