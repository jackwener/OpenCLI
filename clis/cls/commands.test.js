import { describe, expect, it, vi, afterEach } from 'vitest';
import { getRegistry, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import {
  extractArticleDetailFromNextData,
  fetchHtml,
  mapCalendarRows,
  mapHotArticleRows,
  mapHotPlateRows,
  mapHotSubjectRows,
  mapArticleDetailRow,
  mapTelegraphRows,
  normalizeLimit,
  parseArticleId,
} from './utils.js';
import './telegraph.js';
import './article.js';
import './hot.js';
import './subjects.js';
import './plates.js';
import './calendar.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function htmlResponse(body, status = 200) {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('cls command registration', () => {
  it('registers public read commands with stable row columns', () => {
    const telegraph = getRegistry().get('cls/telegraph');
    const article = getRegistry().get('cls/article');
    const hot = getRegistry().get('cls/hot');
    const subjects = getRegistry().get('cls/subjects');
    const plates = getRegistry().get('cls/plates');
    const calendar = getRegistry().get('cls/calendar');

    expect(telegraph).toMatchObject({
      site: 'cls',
      name: 'telegraph',
      access: 'read',
      domain: 'www.cls.cn',
      strategy: Strategy.PUBLIC,
      browser: false,
    });
    expect(telegraph.columns).toEqual([
      'rank',
      'id',
      'title',
      'content',
      'subjects',
      'stocks',
      'level',
      'readingCount',
      'commentCount',
      'shareCount',
      'pubTime',
      'url',
    ]);

    expect(article).toMatchObject({
      site: 'cls',
      name: 'article',
      access: 'read',
      domain: 'www.cls.cn',
      strategy: Strategy.PUBLIC,
      browser: false,
    });
    expect(article.columns).toEqual([
      'id',
      'title',
      'content',
      'brief',
      'subjects',
      'author',
      'level',
      'readingCount',
      'pubTime',
      'audioUrl',
      'url',
    ]);

    expect(hot).toMatchObject({
      site: 'cls',
      name: 'hot',
      access: 'read',
      domain: 'www.cls.cn',
      strategy: Strategy.PUBLIC,
      browser: false,
    });
    expect(hot.columns).toEqual([
      'rank',
      'id',
      'title',
      'brief',
      'author',
      'readingCount',
      'pubTime',
      'url',
    ]);

    expect(subjects).toMatchObject({
      site: 'cls',
      name: 'subjects',
      access: 'read',
      domain: 'www.cls.cn',
      strategy: Strategy.PUBLIC,
      browser: false,
    });
    expect(subjects.columns).toEqual([
      'rank',
      'id',
      'name',
      'description',
      'attentionCount',
      'newestArticleId',
      'newestArticleTitle',
      'url',
    ]);

    expect(plates).toMatchObject({
      site: 'cls',
      name: 'plates',
      access: 'read',
      domain: 'www.cls.cn',
      strategy: Strategy.PUBLIC,
      browser: false,
    });
    expect(plates.columns).toEqual([
      'rank',
      'code',
      'name',
      'changePct',
      'mainFundDiff',
      'upStocks',
      'url',
    ]);

    expect(calendar).toMatchObject({
      site: 'cls',
      name: 'calendar',
      access: 'read',
      domain: 'www.cls.cn',
      strategy: Strategy.PUBLIC,
      browser: false,
    });
    expect(calendar.columns).toEqual([
      'rank',
      'id',
      'date',
      'week',
      'time',
      'title',
      'country',
      'star',
    ]);
  });
});

describe('cls utils', () => {
  it('validates limit without silent clamping', () => {
    expect(normalizeLimit(undefined, 20, 100)).toBe(20);
    expect(normalizeLimit('3', 20, 100)).toBe(3);
    expect(() => normalizeLimit(0, 20, 100)).toThrow(ArgumentError);
    expect(() => normalizeLimit(1.5, 20, 100)).toThrow(ArgumentError);
    expect(() => normalizeLimit(101, 20, 100)).toThrow(ArgumentError);
  });

  it('uses a browser-like user agent for CLS HTML fetches', async () => {
    const fetchMock = vi.fn().mockResolvedValue(htmlResponse('<html></html>'));
    vi.stubGlobal('fetch', fetchMock);

    await fetchHtml('https://www.cls.cn/', 'cls test');

    const headers = fetchMock.mock.calls[0][1].headers;
    expect(headers['User-Agent']).toContain('Chrome/');
    expect(headers['User-Agent']).not.toContain('opencli');
  });

  it('parses a CLS article id from a bare id or detail URL', () => {
    expect(parseArticleId('2411505')).toBe('2411505');
    expect(parseArticleId('https://www.cls.cn/detail/2411505')).toBe('2411505');
    expect(parseArticleId(' https://www.cls.cn/detail/2411505?foo=bar ')).toBe('2411505');
    expect(() => parseArticleId('https://www.cls.cn/telegraph')).toThrow(ArgumentError);
  });

  it('maps telegraph API rows into the declared CLI shape', () => {
    const rows = mapTelegraphRows([
      {
        id: 2411513,
        title: '全国5条中小河流发生超警以上洪水',
        brief: '财联社6月29日电，水利部消息。',
        content: '<p>财联社6月29日电，水利部消息。</p>',
        ctime: 1782691200,
        author: '财联社',
        level: 'B',
        reading_num: 1200,
        comment_num: 3,
        share_num: 4,
        subjects: [{ subject_name: '水利' }, { name: '洪水' }],
        stock_list: [{ stock_code: '601669', stock_name: '中国电建' }],
      },
    ], 1);

    expect(rows).toEqual([{
      rank: 1,
      id: '2411513',
      title: '全国5条中小河流发生超警以上洪水',
      content: '财联社6月29日电，水利部消息。',
      subjects: '水利, 洪水',
      stocks: '中国电建(601669)',
      level: 'B',
      readingCount: 1200,
      commentCount: 3,
      shareCount: 4,
      pubTime: '2026-06-29T00:00:00.000Z',
      url: 'https://www.cls.cn/detail/2411513',
    }]);
  });

  it('uses readable telegraph content as title fallback when API title is empty', () => {
    const rows = mapTelegraphRows([
      {
        id: 2411632,
        title: '',
        brief: '财联社6月29日电，外资周一净卖出价值7.7万亿韩元的韩国综合股价指数（KOSPI）股票，创历史最大单日净卖出规模。',
        content: '财联社6月29日电，外资今日净卖出价值7.7万亿韩元的韩国KOSPI股票，创历史最大单日净卖出规模。',
        ctime: 1782714931,
        reading_num: 47070,
        comment_num: 0,
        share_num: 20,
        subjects: [{ subject_name: '环球市场情报' }],
        stock_list: [],
      },
    ], 1);

    expect(rows[0]).toMatchObject({
      id: '2411632',
      title: '财联社6月29日电，外资今日净卖出价值7.7万亿韩元的韩国KOSPI股票，创历史最大单日净卖出规模。',
      content: '财联社6月29日电，外资今日净卖出价值7.7万亿韩元的韩国KOSPI股票，创历史最大单日净卖出规模。',
    });
  });

  it('extracts and maps article detail from Next.js page state', () => {
    const state = {
      props: {
        pageProps: {
          articleDetail: {
            id: 2411505,
            title: '印尼塞梅鲁火山喷发 灰柱高度约700米',
            brief: '火山喷发快讯',
            content: '<p>财联社6月29日电，印尼火山喷发。</p>',
            ctime: 1782691200,
            readingNum: 88,
            author: '财联社',
            subject: [{ subject_name: '火山' }],
            level: 'C',
            miniMaxAudioUrl: 'https://audio.example/2411505.mp3',
          },
        },
      },
    };
    const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(state)}</script>`;

    const detail = extractArticleDetailFromNextData(html);
    expect(mapArticleDetailRow(detail)).toEqual({
      id: '2411505',
      title: '印尼塞梅鲁火山喷发 灰柱高度约700米',
      content: '财联社6月29日电，印尼火山喷发。',
      brief: '火山喷发快讯',
      subjects: '火山',
      author: '财联社',
      level: 'C',
      readingCount: 88,
      pubTime: '2026-06-29T00:00:00.000Z',
      audioUrl: 'https://audio.example/2411505.mp3',
      url: 'https://www.cls.cn/detail/2411505',
    });
  });

  it('parses Next.js JSON without decoding entities before JSON.parse', () => {
    const state = {
      props: {
        pageProps: {
          articleDetail: {
            id: 2411505,
            title: 'A &quot;quoted&quot; title',
            content: '正文',
          },
        },
      },
    };
    const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(state)}</script>`;

    expect(extractArticleDetailFromNextData(html).title).toBe('A &quot;quoted&quot; title');
  });

  it('maps empty author objects to null instead of object sentinels', () => {
    expect(mapArticleDetailRow({
      id: 2411505,
      title: '印尼塞梅鲁火山喷发 灰柱高度约700米',
      content: '正文',
      author: {},
      subject: [],
    })).toMatchObject({
      author: null,
    });
  });

  it('typed-fails article details without readable content', () => {
    expect(() => mapArticleDetailRow({
      id: 2411505,
      title: '印尼塞梅鲁火山喷发 灰柱高度约700米',
      content: '',
    })).toThrow(CommandExecutionError);
  });

  it('maps homepage hot articles from SSR state', () => {
    expect(mapHotArticleRows([{
      id: 2411240,
      title: '【早报】普京：考虑全面禁止柴油出口',
      brief: '①人工智能标准发布',
      author: '财联社',
      ctime: 1782687600,
      readNum: 598124,
    }], 1)).toEqual([{
      rank: 1,
      id: '2411240',
      title: '【早报】普京：考虑全面禁止柴油出口',
      brief: '①人工智能标准发布',
      author: '财联社',
      readingCount: 598124,
      pubTime: '2026-06-28T23:00:00.000Z',
      url: 'https://www.cls.cn/detail/2411240',
    }]);
  });

  it('maps homepage popular subjects from SSR state', () => {
    expect(mapHotSubjectRows([{
      id: 1556,
      name: '环球市场情报',
      description: '网罗天下要闻',
      attention_num: 161350,
      newest_article_id: 2411657,
      newest_article_title: '西班牙6月CPI同比增长3.2%',
    }], 1)).toEqual([{
      rank: 1,
      id: '1556',
      name: '环球市场情报',
      description: '网罗天下要闻',
      attentionCount: 161350,
      newestArticleId: '2411657',
      newestArticleTitle: '西班牙6月CPI同比增长3.2%',
      url: 'https://www.cls.cn/subject/1556',
    }]);
  });

  it('maps homepage hot plates with percentage output', () => {
    expect(mapHotPlateRows([{
      secu_code: 'cls82054',
      secu_name: '生物制品',
      change: 0.0736,
      main_fund_diff: 848165739,
      up_stock: [
        { secu_code: 'sz300204', secu_name: '舒泰神', change: 0.2 },
        { secu_code: 'sh688765', secu_name: '禾元生物-U', change: 0.2 },
      ],
    }], 1)).toEqual([{
      rank: 1,
      code: 'cls82054',
      name: '生物制品',
      changePct: 7.36,
      mainFundDiff: 848165739,
      upStocks: '舒泰神(sz300204), 禾元生物-U(sh688765)',
      url: 'https://www.cls.cn/plate?code=cls82054',
    }]);
  });

  it('flattens homepage investment calendar days', () => {
    expect(mapCalendarRows([{
      calendar_day: '2026-06-29',
      week: '星期一',
      items: [{
        id: 809033,
        calendar_time: '2026-06-29 00:00:00',
        title: '芝商所推出微型指数期权',
        event: { country: '美国', star: 5 },
      }],
    }], 1)).toEqual([{
      rank: 1,
      id: '809033',
      date: '2026-06-29',
      week: '星期一',
      time: '2026-06-29 00:00:00',
      title: '芝商所推出微型指数期权',
      country: '美国',
      star: 5,
    }]);
  });
});

describe('cls telegraph command', () => {
  const command = () => getRegistry().get('cls/telegraph');

  it('fetches the public telegraph cache endpoint and maps rows', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      errno: 0,
      data: {
        roll_data: [{
          id: 2411513,
          title: '港股午评',
          content: '港股午间收盘。',
          ctime: 1782691200,
          reading_num: 10,
          comment_num: 1,
          share_num: 2,
          subjects: [],
          stock_list: [],
        }],
      },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(command().func({ limit: 1 })).resolves.toEqual([
      expect.objectContaining({
        rank: 1,
        id: '2411513',
        title: '港股午评',
        url: 'https://www.cls.cn/detail/2411513',
      }),
    ]);
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://www.cls.cn/api/cache?name=telegraph');
  });

  it('typed-fails invalid payloads and empty rows', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse({ errno: 0, data: { roll_data: [] } }))
      .mockResolvedValueOnce(jsonResponse({ errno: 0, data: { roll_data: [{ title: 'missing id' }] } })));

    await expect(command().func({ limit: 1 })).rejects.toBeInstanceOf(EmptyResultError);
    await expect(command().func({ limit: 1 })).rejects.toBeInstanceOf(CommandExecutionError);
  });
});

describe('cls article command', () => {
  const command = () => getRegistry().get('cls/article');

  it('fetches a public detail page and extracts articleDetail from __NEXT_DATA__', async () => {
    const state = {
      props: {
        pageProps: {
          articleDetail: {
            id: 2411505,
            title: '文章标题',
            brief: '',
            content: '文章正文',
            ctime: 1782691200,
            readingNum: 7,
            subject: [],
          },
        },
      },
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(htmlResponse(
      `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(state)}</script>`,
    )));

    await expect(command().func({ id: 'https://www.cls.cn/detail/2411505' })).resolves.toEqual([
      expect.objectContaining({
        id: '2411505',
        title: '文章标题',
        content: '文章正文',
        url: 'https://www.cls.cn/detail/2411505',
      }),
    ]);
  });

  it('typed-fails missing article state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(htmlResponse('<html></html>')));

    await expect(command().func({ id: '2411505' })).rejects.toBeInstanceOf(EmptyResultError);
  });
});

describe('cls homepage SSR commands', () => {
  const homeState = {
    props: {
      pageProps: {
        hotArticleData: [{
          id: 2411240,
          title: '热门文章',
          brief: '摘要',
          author: '财联社',
          ctime: 1782687600,
          readNum: 100,
        }],
        hotSubject: [{
          id: 1556,
          name: '环球市场情报',
          description: '网罗天下要闻',
          attention_num: 161350,
          newest_article_id: 2411657,
          newest_article_title: '最新文章',
        }],
        hotPlate: [{
          secu_code: 'cls82054',
          secu_name: '生物制品',
          change: 0.0736,
          main_fund_diff: 848165739,
          up_stock: [],
        }],
        investKalendarData: [{
          calendar_day: '2026-06-29',
          week: '星期一',
          items: [{ id: 809033, calendar_time: '2026-06-29 00:00:00', title: '事件', event: { country: '美国', star: 5 } }],
        }],
      },
    },
  };

  function stubHomePage() {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(htmlResponse(
      `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(homeState)}</script>`,
    )));
  }

  it('hot command fetches homepage SSR data', async () => {
    stubHomePage();
    await expect(getRegistry().get('cls/hot').func({ limit: 1 })).resolves.toEqual([
      expect.objectContaining({ id: '2411240', title: '热门文章' }),
    ]);
  });

  it('subjects command fetches homepage SSR data', async () => {
    stubHomePage();
    await expect(getRegistry().get('cls/subjects').func({ limit: 1 })).resolves.toEqual([
      expect.objectContaining({ id: '1556', name: '环球市场情报' }),
    ]);
  });

  it('plates command fetches homepage SSR data', async () => {
    stubHomePage();
    await expect(getRegistry().get('cls/plates').func({ limit: 1 })).resolves.toEqual([
      expect.objectContaining({ code: 'cls82054', name: '生物制品' }),
    ]);
  });

  it('calendar command fetches homepage SSR data', async () => {
    stubHomePage();
    await expect(getRegistry().get('cls/calendar').func({ limit: 1 })).resolves.toEqual([
      expect.objectContaining({ id: '809033', title: '事件' }),
    ]);
  });
});
