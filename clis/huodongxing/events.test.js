import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import {
  buildEventsUrl,
  filterRowsByDateRange,
  extractEventRows,
  extractEventRowsPayload,
  requireLimit,
} from './events.js';

const SAMPLE_HTML = `
<html>
  <body>
    <div class="search-tab-content-list-check flex swiper-wrapper">
      <div class="search-tab-content-item-mesh" style="position: relative;">
        <a href="/event/7864377535500?utm_source=eventspage" target="_blank">
          <img class="item-logo" src="cover.jpg" alt="企业级AI项目合作沟通会" />
        </a>
        <div class="item-mesh-conter">
          <a class="item-title" href="/event/7864377535500?utm_source=eventspage" target="_blank">
            <img src="pin.png" alt="">
            <span>企业级AI项目合作沟通会，复制成熟AI落地案例-AI创业、传统行业AI转型【杭州】</span>
          </a>
          <div class="item-dress flex">
            <p>06/24 周三 14:00</p>
            <span>
              <span class="item-dress-icon icon"></span>
              <span class="item-dress-pp">浙江杭州</span>
            </span>
          </div>
        </div>
        <div class="item-mesh-bottom flex">
          <div class="item-bottom-left flex">
            <a class="flex" href="/org/591375868358" target="_blank">
              <img class="user-logo org-logo" alt="司马阅" title="司马阅" />
              <div><p class="user-name">司马阅</p></div>
            </a>
          </div>
        </div>
      </div>
      <div class="search-tab-content-item-mesh" style="position: relative;">
        <a href="/event/9864368522322?utm_source=eventspage" target="_blank">
          <img class="item-logo" src="cover2.jpg" alt="MuleRun专场：全职能智能办公，从此开始" />
        </a>
        <div class="item-mesh-conter">
          <a class="item-title" href="/event/9864368522322?utm_source=eventspage" target="_blank">MuleRun专场：全职能智能办公，从此开始</a>
          <div class="item-dress flex">
            <p>今天 14:00</p>
            <span>
              <span class="item-live-icon icon"></span>
              <span class="item-dress-pp">线上活动</span>
            </span>
          </div>
        </div>
        <div class="item-mesh-bottom flex">
          <div class="item-bottom-left flex">
            <a class="flex" href="/org/123" target="_blank">
              <img class="user-logo org-logo" alt="MuleRun" title="MuleRun" />
              <div><p class="user-name">MuleRun</p></div>
            </a>
          </div>
        </div>
      </div>
      <div class="search-tab-content-item-mesh" style="position: relative;">
        <a href="/event/9864368522322?utm_source=eventspage" target="_blank">
          <img class="item-logo" src="cover2.jpg" alt="MuleRun专场：全职能智能办公，从此开始" />
        </a>
        <div class="item-mesh-conter">
          <a class="item-title" href="/event/9864368522322?utm_source=eventspage" target="_blank">MuleRun专场：全职能智能办公，从此开始</a>
          <div class="item-dress flex">
            <p>今天 14:00</p>
            <span><span class="item-live-icon icon"></span><span class="item-dress-pp">线上活动</span></span>
          </div>
        </div>
      </div>
    </div>
  </body>
</html>`;

const MALFORMED_CARD_HTML = `
<html>
  <body>
    <div class="search-tab-content-item-mesh">
      <a class="item-title" href="/event/">missing stable id</a>
    </div>
  </body>
</html>`;

function withDocument(html, callback) {
  const dom = new JSDOM(html, { url: 'https://www.huodongxing.com/events' });
  const previousDocument = globalThis.document;
  const previousLocation = globalThis.location;
  globalThis.document = dom.window.document;
  globalThis.location = dom.window.location;
  try {
    return callback();
  } finally {
    globalThis.document = previousDocument;
    globalThis.location = previousLocation;
  }
}

describe('huodongxing events adapter', () => {
  it('registers a public browser read command', () => {
    const command = getRegistry().get('huodongxing/events');

    expect(command).toBeDefined();
    expect(command.browser).toBe(true);
    expect(command.strategy).toBe('public');
    expect(command.columns).toEqual([
      'rank',
      'id',
      'title',
      'time',
      'eventType',
      'city',
      'location',
      'organizer',
      'url',
    ]);
  });

  it('builds the official events URL with supported filters', () => {
    const url = buildEventsUrl({
      tag: 'AI',
      city: '全部',
      date: '2026-06-09',
      dateTo: '2026-06-12',
      eventType: 1,
      qs: 'Agentic 工作坊',
    });

    expect(url).toBe(
      'https://www.huodongxing.com/events?orderby=o&d=ts&date=2026-06-09&dateTo=2026-06-12&tag=AI&city=%E5%85%A8%E9%83%A8&eventType=1&qs=Agentic+%E5%B7%A5%E4%BD%9C%E5%9D%8A',
    );
  });

  it('validates limit and eventType arguments', () => {
    expect(requireLimit(undefined)).toBe(20);
    expect(requireLimit('2')).toBe(2);
    expect(() => requireLimit(0)).toThrow(ArgumentError);
    expect(() => requireLimit(51)).toThrow(ArgumentError);
    expect(() => buildEventsUrl({ eventType: 3 })).toThrow(ArgumentError);
  });

  it('validates date filters before navigation', () => {
    expect(() => buildEventsUrl({ date: '2026-02-30' })).toThrow(ArgumentError);
    expect(() => buildEventsUrl({ date: '2026/02/28' })).toThrow(ArgumentError);
    expect(() => buildEventsUrl({ date: '2026-06-12', dateTo: '2026-06-09' })).toThrow(ArgumentError);
  });

  it('filters Huodongxing loose date results by parsed event date overlap', () => {
    const rows = [
      { rank: 1, id: 'future', time: '07/23 周四 09:00' },
      { rank: 2, id: 'tomorrow', time: '明天 14:30' },
      { rank: 3, id: 'range', time: '06/13 周六 ~ 07/04 周六' },
      { rank: 4, id: 'same-day', time: '06/14 周日 10:00' },
      { rank: 5, id: 'today', time: '今天 14:00' },
    ];

    expect(filterRowsByDateRange(rows, {
      date: '2026-06-13',
      dateTo: '2026-06-14',
      referenceDate: new Date('2026-06-12T12:00:00+08:00'),
    })).toEqual([
      { rank: 1, id: 'tomorrow', time: '明天 14:30' },
      { rank: 2, id: 'range', time: '06/13 周六 ~ 07/04 周六' },
      { rank: 3, id: 'same-day', time: '06/14 周日 10:00' },
    ]);
  });

  it('extracts normalized event rows and deduplicates repeated event cards', () => {
    const rows = withDocument(SAMPLE_HTML, () => extractEventRows(10));

    expect(rows).toEqual([
      {
        rank: 1,
        id: '7864377535500',
        title: '企业级AI项目合作沟通会，复制成熟AI落地案例-AI创业、传统行业AI转型【杭州】',
        time: '06/24 周三 14:00',
        eventType: 'offline',
        city: '浙江杭州',
        location: '浙江杭州',
        organizer: '司马阅',
        url: 'https://www.huodongxing.com/event/7864377535500',
      },
      {
        rank: 2,
        id: '9864368522322',
        title: 'MuleRun专场：全职能智能办公，从此开始',
        time: '今天 14:00',
        eventType: 'online',
        city: '线上活动',
        location: '线上活动',
        organizer: 'MuleRun',
        url: 'https://www.huodongxing.com/event/9864368522322',
      },
    ]);
  });

  it('can run the extractor as an injected browser function', () => {
    const result = withDocument(SAMPLE_HTML, () => {
      const injected = new Function(`return (${extractEventRowsPayload.toString()})(10);`);
      return injected();
    });

    expect(result.ok).toBe(true);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].id).toBe('7864377535500');
  });

  it('throws EmptyResultError when no event cards are found', () => {
    expect(() => withDocument('<html><body>暂无活动</body></html>', () => extractEventRows(10)))
      .toThrow(EmptyResultError);
  });

  it('throws CommandExecutionError when event cards cannot produce stable rows', () => {
    expect(() => withDocument(MALFORMED_CARD_HTML, () => extractEventRows(10)))
      .toThrow(CommandExecutionError);
  });

  it('classifies Huodongxing rate-limit pages separately from empty results', () => {
    expect(() => withDocument('<html><head><title>操作过于频繁</title></head><body>操作过于频繁</body></html>', () => extractEventRows(10)))
      .toThrow(CommandExecutionError);
  });

  it('throws typed errors from structured browser extraction failures', async () => {
    const command = getRegistry().get('huodongxing/events');
    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      wait: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue({
        ok: false,
        code: 'RATE_LIMIT',
        message: 'huodongxing events was rate limited by www.huodongxing.com',
        hint: 'Wait a few minutes and retry from a real browser session.',
      }),
    };

    await expect(command.func(page, { limit: 5 })).rejects.toThrow(CommandExecutionError);
  });

  it('unwraps Browser Bridge evaluate envelopes before validating extraction rows', async () => {
    const command = getRegistry().get('huodongxing/events');
    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      wait: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue({
        session: 'adapter-window',
        data: {
          ok: true,
          rows: [
            {
              rank: 1,
              id: '7864377535500',
              title: 'AI Meetup',
              time: '06/24 周三 14:00',
              eventType: 'offline',
              city: '浙江杭州',
              location: '浙江杭州',
              organizer: 'Org',
              url: 'https://www.huodongxing.com/event/7864377535500',
            },
          ],
        },
      }),
    };

    await expect(command.func(page, { limit: 5 })).resolves.toEqual([
      {
        rank: 1,
        id: '7864377535500',
        title: 'AI Meetup',
        time: '06/24 周三 14:00',
        eventType: 'offline',
        city: '浙江杭州',
        location: '浙江杭州',
        organizer: 'Org',
        url: 'https://www.huodongxing.com/event/7864377535500',
      },
    ]);
  });

  it('throws CommandExecutionError for malformed browser extraction payloads', async () => {
    const command = getRegistry().get('huodongxing/events');
    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      wait: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue({ ok: true, rows: null }),
    };

    await expect(command.func(page, { limit: 5 })).rejects.toThrow(CommandExecutionError);
  });
});
