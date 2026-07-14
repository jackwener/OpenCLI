import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
import { cnkiSearchUrl, extractCnkiDetail, normalizeCnkiUrl } from './shared.js';

function parseLimit(value, fallback = 10) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.max(0, parsed);
}

function requireNonEmptyQuery(value) {
  const query = String(value ?? '').trim();
  if (!query) {
    throw new ArgumentError('Search query must not be empty.');
  }
  return query;
}

function normalizeList(value) {
  return String(value ?? '')
    .split(',')
    .map(item => item.trim().toLowerCase())
    .filter(Boolean);
}

function parseDocTypes(value) {
  const map = {
    all: '',
    journal: 'YSTT4HG0',
    journals: 'YSTT4HG0',
    dissertation: 'LSTPFY1C',
    dissertations: 'LSTPFY1C',
    thesis: 'LSTPFY1C',
    degree: 'LSTPFY1C',
    conference: 'JUP3MUPD',
    conferences: 'JUP3MUPD',
    newspaper: 'MPMFIG1A',
    newspapers: 'MPMFIG1A',
    book: 'EMRPGLPA',
    books: 'EMRPGLPA',
    standard: 'WQ0UVIAA',
    standards: 'WQ0UVIAA',
    achievement: 'BLZOG7CK',
    achievements: 'BLZOG7CK',
    patent: 'VUDIXAIY',
    patents: 'VUDIXAIY',
    yearbook: 'HHCPM1F8',
    yearbooks: 'HHCPM1F8',
    ccjd: 'PWFIRAGL',
    special: 'NN3FJMUV',
    video: 'NLBO1Z6R',
    videos: 'NLBO1Z6R',
    library: 'T2VC03OH',
    ystt4hg0: 'YSTT4HG0',
    lstpfy1c: 'LSTPFY1C',
    jup3mupd: 'JUP3MUPD',
    mpmfig1a: 'MPMFIG1A',
    emrpglpa: 'EMRPGLPA',
    wq0uviaa: 'WQ0UVIAA',
    blzog7ck: 'BLZOG7CK',
    vudixaiy: 'VUDIXAIY',
    hhcpm1f8: 'HHCPM1F8',
    pwfiragl: 'PWFIRAGL',
    nn3fjmuv: 'NN3FJMUV',
    nlbo1z6r: 'NLBO1Z6R',
    t2vc03oh: 'T2VC03OH',
  };
  const values = normalizeList(value);
  if (values.length === 0 || values.includes('all')) return '';
  return Array.from(new Set(values.map(item => map[item] || item.toUpperCase()))).join(',');
}

function validateDate(value, name) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new ArgumentError(`${name} must be in YYYY-MM-DD format.`);
  }
  return text;
}

function normalizeField(value) {
  const field = String(value ?? '').trim().toUpperCase();
  if (!field) return '';
  const allowed = new Set([
    'SU', 'TKA', 'KY', 'TI', 'FT', 'AU', 'FI', 'RP', 'AF', 'FU',
    'AB', 'CO', 'RF', 'CLC', 'LY', 'DOI', 'CF',
  ]);
  if (!allowed.has(field)) {
    throw new ArgumentError(`Unsupported CNKI field: ${field}`);
  }
  return field;
}

function quoteCnkiTerm(value) {
  return `'${String(value ?? '').replace(/'/g, "\\'")}'`;
}

cli({
  site: 'cnki',
  name: 'search',
  description: 'CNKI paper search',
  access: 'read',
  domain: 'kns.cnki.net',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'query', positional: true, required: false, help: 'Search query' },
    { name: 'limit', type: 'int', default: 10, help: 'Max results; 0 means all pages OpenCLI can reach' },
    { name: 'with-abstract', type: 'bool', default: false, help: 'Open each detail page and extract abstracts' },
    { name: 'expr', type: 'str', default: '', help: 'CNKI professional search expression, for example: TI=rutting and KY=pavement' },
    { name: 'field', type: 'str', default: '', help: 'CNKI field for query when --expr is not used: SU,TKA,KY,TI,FT,AU,FI,RP,AF,FU,AB,CO,RF,CLC,LY,DOI,CF' },
    { name: 'from', type: 'str', default: '', help: 'Publish date start, YYYY-MM-DD' },
    { name: 'to', type: 'str', default: '', help: 'Publish date end, YYYY-MM-DD' },
    { name: 'types', type: 'str', default: '', help: 'Comma-separated document types: journal,dissertation,conference,newspaper,book,patent,standard,achievement,yearbook' },
  ],
  columns: ['rank', 'title', 'authors', 'journal', 'date', 'year', 'volume', 'issue', 'pages', 'doi', 'classification', 'abstract', 'keywords', 'url'],
  navigateBefore: false,
  func: async (page, kwargs) => {
    const limit = parseLimit(kwargs.limit, 10);
    const unlimited = limit === 0;
    const field = normalizeField(kwargs.field);
    const query = (String(kwargs.query ?? '').trim() || '');
    const expr = String(kwargs.expr ?? '').trim() || (field ? `${field}=${quoteCnkiTerm(requireNonEmptyQuery(query))}` : '');
    if (!expr) requireNonEmptyQuery(query);
    const withAbstract = Boolean(kwargs.withAbstract ?? kwargs['with-abstract']);
    const fromDate = validateDate(kwargs.from, '--from');
    const toDate = validateDate(kwargs.to, '--to');
    const typeCodes = parseDocTypes(kwargs.types);

    if (expr) {
      await page.goto('https://kns.cnki.net/kns8s/AdvSearch?type=expert', { waitUntil: 'none', settleMs: 1500 });
      await page.wait(5);
      await page.evaluate(`
        (() => {
          const setValue = (el, value) => {
            if (!el) return false;
            el.value = value;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          };
          setValue(document.querySelector('textarea.majorSearch'), ${JSON.stringify(expr)});
          setValue(document.querySelector('#datebox0'), ${JSON.stringify(fromDate)});
          setValue(document.querySelector('#datebox1'), ${JSON.stringify(toDate)});
          const checkedDb = document.querySelector('#CheckedDB');
          if (checkedDb && ${JSON.stringify(typeCodes)}) {
            checkedDb.value = ${JSON.stringify(typeCodes)};
            checkedDb.dispatchEvent(new Event('change', { bubbles: true }));
          }
          const button = document.querySelector('.search-middle .btn-search');
          if (button) {
            button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            button.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
            button.click();
          }
          return true;
        })()
      `);
    } else {
      await page.goto('https://www.cnki.net/', { waitUntil: 'none', settleMs: 1500 });
      await page.wait(4);
      const clicked = await page.evaluate(`
      (() => {
        const input = document.querySelector('#txt_SearchText');
        const button = document.querySelector('.search-form .search-btn');
        if (!input || !button) return false;
        input.value = ${JSON.stringify(query)};
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        button.click();
        return true;
      })()
    `);
      if (!clicked) {
        await page.goto(cnkiSearchUrl(query), { waitUntil: 'none', settleMs: 1500 });
      }
    }
    await page.wait(8);

    const results = [];
    const seenItems = new Set();
    const seenPages = new Set();

    while (unlimited || results.length < limit) {
      const pageKey = await page.evaluate(`
        (() => {
          const pageNo = document.querySelector('#curPageHid')?.value
            || document.querySelector('.pages .cur, .page .cur, .page-nav .cur')?.textContent
            || '';
          return location.href + '#page=' + String(pageNo).trim();
        })()
      `);
      if (pageKey) {
        if (seenPages.has(pageKey)) break;
        seenPages.add(pageKey);
      }

      const remaining = unlimited ? Number.MAX_SAFE_INTEGER : limit - results.length;
      const payload = await page.evaluate(`
        (async () => {
          const normalize = v => (v || '').replace(/\\u00a0/g, ' ').replace(/\\s+/g, ' ').trim();
          const rowsReady = () => document.querySelector('.result-table-list tbody tr, #gridTable tbody tr, table.result-table tbody tr, table.GridTableContent tbody tr');
          for (let i = 0; i < 40; i++) {
            if (rowsReady()) break;
            await new Promise(r => setTimeout(r, 500));
          }
          if (/\\u5b89\\u5168\\u9a8c\\u8bc1|verify/i.test(document.title) || document.querySelector('[src*="/verify/"], [href*="/verify/"]')) {
            return {
              results: [{ rank: 0, title: 'CNKI security verification required', authors: '', journal: '', date: '', abstract: '', url: location.href, verificationRequired: true }],
              nextUrl: '',
              hasClickableNext: false,
            };
          }

          const rowSelectors = '.result-table-list tbody tr, #gridTable tbody tr, table.result-table tbody tr, table.GridTableContent tbody tr';
          const results = [];
          for (const row of document.querySelectorAll(rowSelectors)) {
            const tds = row.querySelectorAll('td');
            const nameCell = row.querySelector('td.name') || row.querySelector('.name') || row.querySelector('.title') || tds[2] || row;
            const titleEl = nameCell?.querySelector('a') || row.querySelector('a[href*="detail"], a[href*="kcms"], a[href*="KCMS"]');
            const title = normalize(titleEl?.textContent).replace(/\\u514d\\u8d39$/, '');
            if (!title) continue;

            let url = titleEl?.getAttribute('href') || '';
            if (url && !/^https?:\\/\\//i.test(url)) {
              url = url.startsWith('//') ? 'https:' + url : 'https://kns.cnki.net' + (url.startsWith('/') ? url : '/' + url);
            }

            const authorCell = row.querySelector('td.author, .author, .authors') || tds[3];
            const journalCell = row.querySelector('td.source, .source, .journal') || tds[4];
            const dateCell = row.querySelector('td.date, .date, .year') || tds[5];

            results.push({
              rank: results.length + 1,
              title,
              authors: normalize(authorCell?.textContent),
              journal: normalize(journalCell?.textContent),
              date: normalize(dateCell?.textContent),
              abstract: '',
              url,
            });
            if (results.length >= ${remaining}) break;
          }

          const isDisabled = el => {
            const cls = String(el.className || '');
            return el.disabled || el.getAttribute('aria-disabled') === 'true' || /disabled|disable|unusable/i.test(cls);
          };
          const toAbsoluteUrl = href => {
            if (!href || /^javascript:/i.test(href)) return '';
            try { return new URL(href, location.href).href; } catch { return ''; }
          };
          const nextEl = document.querySelector('#PageNext') || Array.from(document.querySelectorAll('a, button')).find(el => {
            if (isDisabled(el)) return false;
            const text = normalize(el.textContent || el.getAttribute('aria-label') || el.title || '');
            const rel = String(el.getAttribute('rel') || '').toLowerCase();
            const cls = String(el.className || '').toLowerCase();
            return rel === 'next' || /next/.test(cls) || /\\u4e0b\\u4e00\\u9875|Next|>/i.test(text);
          }) || null;

          const nextUrl = toAbsoluteUrl(nextEl?.getAttribute('href') || '');
          return {
            results,
            nextUrl,
            hasClickableNext: Boolean(nextEl && !nextUrl),
          };
        })()
      `);

      const pageResults = Array.isArray(payload?.results) ? payload.results : [];
      const before = results.length;
      for (const item of pageResults) {
        const key = item.url || `${item.title}|${item.authors}|${item.journal}|${item.date}`;
        if (seenItems.has(key)) continue;
        seenItems.add(key);
        results.push({ ...item, rank: results.length + 1 });
        if (!unlimited && results.length >= limit) break;
      }

      if ((!unlimited && results.length >= limit) || pageResults.length === 0) break;

      if (payload?.nextUrl) {
        await page.goto(payload.nextUrl, { waitUntil: 'none', settleMs: 1500 });
        await page.wait(4);
        continue;
      }

      if (payload?.hasClickableNext) {
        const clickedNext = await page.evaluate(`
          (() => {
            const normalize = v => (v || '').replace(/\\s+/g, ' ').trim();
            const isDisabled = el => {
              const cls = String(el.className || '');
              return el.disabled || el.getAttribute('aria-disabled') === 'true' || /disabled|disable|unusable/i.test(cls);
            };
            const nextEl = document.querySelector('#PageNext') || Array.from(document.querySelectorAll('a, button')).find(el => {
              if (isDisabled(el)) return false;
              const text = normalize(el.textContent || el.getAttribute('aria-label') || el.title || '');
              const rel = String(el.getAttribute('rel') || '').toLowerCase();
              const cls = String(el.className || '').toLowerCase();
              return rel === 'next' || /next/.test(cls) || /\\u4e0b\\u4e00\\u9875|Next|>/i.test(text);
            });
            if (!nextEl) return false;
            nextEl.click();
            return true;
          })()
        `);
        if (clickedNext) {
          await page.wait(5);
          continue;
        }
      }

      if (results.length === before) break;
      break;
    }

    if (!withAbstract) return results;

    const searchUrl = await page.getCurrentUrl?.();
    for (const item of results) {
      if (!item.url) continue;
      try {
        const detail = await extractCnkiDetail(page, normalizeCnkiUrl(item.url));
        Object.assign(item, {
          title: detail.title || item.title,
          authors: detail.authors || item.authors,
          journal: detail.journal || item.journal,
          source: detail.source || '',
          date: detail.date || item.date,
          year: detail.year || '',
          volume: detail.volume || '',
          issue: detail.issue || '',
          pages: detail.pages || '',
          startPage: detail.startPage || '',
          endPage: detail.endPage || '',
          doi: detail.doi || '',
          classification: detail.classification || '',
          album: detail.album || '',
          subject: detail.subject || '',
          fund: detail.fund || '',
          onlinePublishedAt: detail.onlinePublishedAt || '',
          cnkiId: detail.cnkiId || '',
          abstract: detail.abstract || '',
          keywords: detail.keywords.join(', '),
          detailVerificationRequired: detail.verificationRequired,
        });
      } catch (err) {
        item.abstract = '';
        item.detailError = err instanceof Error ? err.message : String(err);
      }
    }
    if (searchUrl) {
      await page.goto(searchUrl, { waitUntil: 'none', settleMs: 500 }).catch(() => undefined);
    }
    return results;
  },
});
