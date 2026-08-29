import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './sources.js';
import './search.js';
import './source.js';
import './categories.js';
import './overview.js';
import './article.js';
import './page.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('macro command registration', () => {
  it('registers the macro source commands under one group', () => {
    for (const name of ['sources', 'search', 'source', 'categories', 'overview', 'article', 'page']) {
      expect(getRegistry().get(`macro/${name}`)).toBeDefined();
    }
  });
});

describe('macro sources data', () => {
  it('lists national and international sources from the PDF', async () => {
    const command = getRegistry().get('macro/sources');
    const result = await command.func(null, {});

    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'stats-cn', name: '国家统计局' }),
      expect.objectContaining({ id: 'imf', name: 'IMF 国际货币基金组织' }),
      expect.objectContaining({ id: 'bis', name: 'BIS Data Portal 国际清算银行' }),
    ]));
  });

  it('filters source list by category', async () => {
    const command = getRegistry().get('macro/sources');
    const result = await command.func(null, { category: 'international-org' });

    expect(result).toHaveLength(9);
    expect(result.every(row => row.category === '全球信息源-国际组织')).toBe(true);
  });

  it('searches by data type and aliases', async () => {
    const command = getRegistry().get('macro/search');
    const energy = await command.func(null, { query: '能源' });
    const centralBank = await command.func(null, { query: '央行' });

    expect(energy.map(row => row.id)).toEqual(expect.arrayContaining(['iea']));
    expect(centralBank).toEqual([
      expect.objectContaining({ id: 'pbc', name: '中国人民银行' }),
    ]);
  });

  it('returns detail rows for a source selector', async () => {
    const command = getRegistry().get('macro/source');
    const result = await command.func(null, { id: '财政部' });

    expect(result).toEqual(expect.arrayContaining([
      { field: 'id', value: 'mof-cn' },
      expect.objectContaining({ field: 'urls', value: 'https://www.mof.gov.cn/gkml/' }),
    ]));
  });

  it('does not resolve broad source queries through the full data haystack', async () => {
    const command = getRegistry().get('macro/source');

    await expect(command.func(null, { id: '能源' })).rejects.toMatchObject({
      code: 'ARGUMENT',
    });
  });

  it('reports unknown source ids as argument errors', async () => {
    const command = getRegistry().get('macro/source');

    await expect(command.func(null, { id: 'not-a-source' })).rejects.toMatchObject({
      code: 'ARGUMENT',
    });
  });

  it('returns the article body text', async () => {
    const command = getRegistry().get('macro/article');
    const result = await command.func(null, { section: '国家级数据' });

    expect(result.text).toContain('迄今为止，国家统计局的官方数据仍旧是可参照、成体系、有接续的数据源');
    expect(result.text).toContain('https://www.stats.gov.cn/sj/');
    expect(result.text).not.toContain('IMF 国际货币基金组织');
  });

  it('fetches and extracts actual webpage content', async () => {
    const html = `
      <html>
        <head><title>统计数据</title></head>
        <body>
          <script>window.noise = true;</script>
          <main>
            <h1>统计数据</h1>
            <p>居民消费价格指数 CPI 发布。</p>
            <a href="/sj/zxfb/202604/t20260430_1.html">2026年4月中国采购经理指数运行情况 2026-04-30</a>
            <a href="/sj/zxfb/202503/t20250331_1.html">2025年3月居民消费价格指数 2025-03-31</a>
          </main>
        </body>
      </html>
    `;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      url: 'https://www.stats.gov.cn/sj/',
      headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
      arrayBuffer: async () => new TextEncoder().encode(html).buffer,
    }));

    const command = getRegistry().get('macro/page');
    const result = await command.func(null, { id: 'stats-cn', date: '2026-04', limit: 20 });

    expect(result).toEqual([
      expect.objectContaining({
        date: '2026-04-30',
        title: '2026年4月中国采购经理指数运行情况 2026-04-30',
        url: 'https://www.stats.gov.cn/sj/zxfb/202604/t20260430_1.html',
      }),
    ]);
  });

  it('can fetch detail pages for filtered items', async () => {
    const listHtml = `
      <html><body>
        <a href="/sj/zxfb/202604/t20260430_1.html">2026年4月中国采购经理指数运行情况 2026-04-30</a>
      </body></html>
    `;
    const detailHtml = `
      <html><body>
        <div class="TRS_Editor">
          <p>4月份，制造业采购经理指数为50.4%，继续位于扩张区间。</p>
        </div>
      </body></html>
    `;
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        url: 'https://www.stats.gov.cn/sj/',
        headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
        arrayBuffer: async () => new TextEncoder().encode(listHtml).buffer,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        url: 'https://www.stats.gov.cn/sj/zxfb/202604/t20260430_1.html',
        headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
        arrayBuffer: async () => new TextEncoder().encode(detailHtml).buffer,
      }));

    const command = getRegistry().get('macro/page');
    const result = await command.func(null, { id: 'stats-cn', date: '2026-04', detail: true, chars: 100 });

    expect(result[0].text).toContain('制造业采购经理指数为50.4%');
  });

  it('rejects invalid date filters before fetching the source page', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const command = getRegistry().get('macro/page');

    await expect(command.func(null, { id: 'stats-cn', date: '2026-13' })).rejects.toMatchObject({
      code: 'ARGUMENT',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects out-of-range source URL indexes before fetching', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const command = getRegistry().get('macro/page');

    await expect(command.func(null, { id: 'imf', 'url-index': 3 })).rejects.toMatchObject({
      code: 'ARGUMENT',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('extracts item dates from link context and compact date URLs', async () => {
    const html = `
      <html>
        <body>
          <ul>
            <li><span class="date">2026-04-30</span><a href="/sj/zxfb/context.html">中国采购经理指数运行情况</a></li>
            <li><a href="/sj/zxfb/t20260430_2.html">居民消费价格指数发布</a></li>
          </ul>
        </body>
      </html>
    `;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      url: 'https://www.stats.gov.cn/sj/',
      headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
      arrayBuffer: async () => new TextEncoder().encode(html).buffer,
    }));

    const command = getRegistry().get('macro/page');
    const result = await command.func(null, { id: 'stats-cn', date: '2026-04-30', limit: 10 });

    expect(result.map(row => row.date)).toEqual(['2026-04-30', '2026-04-30']);
    expect(result.map(row => row.url)).toEqual([
      'https://www.stats.gov.cn/sj/zxfb/context.html',
      'https://www.stats.gov.cn/sj/zxfb/t20260430_2.html',
    ]);
  });
});
