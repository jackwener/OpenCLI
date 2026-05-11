import { describe, it, expect } from 'vitest';
import {
  analyzeSite,
  detectAntiBot,
  classifyPattern,
  findNearestAdapter,
  type PageSignals,
} from './analyze.js';
import type { CliCommand } from '../registry.js';

function mkSignals(overrides: Partial<PageSignals> = {}): PageSignals {
  return {
    requestedUrl: 'https://example.com/',
    finalUrl: 'https://example.com/',
    cookieNames: [],
    networkEntries: [],
    initialState: {
      __INITIAL_STATE__: false,
      __NUXT__: false,
      __NEXT_DATA__: false,
      __APOLLO_STATE__: false,
    },
    title: 'Example',
    ...overrides,
  };
}

function mkCmd(site: string, name: string, domain?: string): CliCommand {
  return {
    site,
    name,
    access: 'read',
    description: '',
    domain,
    browser: false,
    args: [],
  };
}

describe('detectAntiBot', () => {
  it('flags Aliyun WAF from cookie', () => {
    const v = detectAntiBot(mkSignals({ cookieNames: ['JSESSIONID', 'acw_sc__v2'] }));
    expect(v.detected).toBe(true);
    expect(v.vendor).toBe('aliyun_waf');
    expect(v.evidence).toContain('cookie:acw_sc__v2');
    expect(v.implication).toMatch(/browser context/i);
  });

  it('flags Aliyun WAF from challenge HTML body', () => {
    const v = detectAntiBot(
      mkSignals({
        networkEntries: [
          {
            url: 'https://x.com/',
            status: 200,
            contentType: 'text/html',
            bodyPreview: "var arg1 = 'A1B2C3D4E5F6A7B8C9D0E1F2A3B4C5D6';",
          },
        ],
      }),
    );
    expect(v.detected).toBe(true);
    expect(v.vendor).toBe('aliyun_waf');
  });

  it('flags Cloudflare from cf_clearance cookie', () => {
    const v = detectAntiBot(mkSignals({ cookieNames: ['cf_clearance'] }));
    expect(v.vendor).toBe('cloudflare');
    expect(v.implication).toMatch(/Cloudflare/i);
  });

  it('flags Akamai from _abck cookie', () => {
    const v = detectAntiBot(mkSignals({ cookieNames: ['_abck', 'bm_sz'] }));
    expect(v.vendor).toBe('akamai');
  });

  it('returns no-match verdict with actionable fallback advice', () => {
    const v = detectAntiBot(mkSignals());
    expect(v.detected).toBe(false);
    expect(v.vendor).toBeNull();
    expect(v.implication).toMatch(/Node-side COOKIE fetch first/);
  });
});

describe('classifyPattern', () => {
  it('returns A for JSON-heavy pages without SSR state', () => {
    const v = classifyPattern(
      mkSignals({
        networkEntries: [
          { url: 'https://x.com/api/a', status: 200, contentType: 'application/json', bodyPreview: '{}' },
          { url: 'https://x.com/api/b', status: 200, contentType: 'application/json;charset=utf-8', bodyPreview: '{}' },
        ],
      }),
    );
    expect(v.pattern).toBe('A');
    expect(v.json_responses).toBe(2);
  });

  it('returns B when __INITIAL_STATE__ is present, beating JSON signals', () => {
    const v = classifyPattern(
      mkSignals({
        initialState: { __INITIAL_STATE__: true, __NUXT__: false, __NEXT_DATA__: false, __APOLLO_STATE__: false },
        networkEntries: [
          { url: 'https://x.com/api/a', status: 200, contentType: 'application/json', bodyPreview: '{}' },
        ],
      }),
    );
    expect(v.pattern).toBe('B');
  });

  it('returns D when auth failures dominate', () => {
    const v = classifyPattern(
      mkSignals({
        networkEntries: [
          { url: 'https://x.com/api/a', status: 401, contentType: 'application/json', bodyPreview: '' },
          { url: 'https://x.com/api/b', status: 403, contentType: 'application/json', bodyPreview: '' },
        ],
      }),
    );
    expect(v.pattern).toBe('D');
    expect(v.auth_failures).toBe(2);
  });

  it('returns C by default for static pages', () => {
    const v = classifyPattern(mkSignals());
    expect(v.pattern).toBe('C');
  });
});

describe('findNearestAdapter', () => {
  it('matches by domain suffix', () => {
    const reg = new Map<string, CliCommand>([
      ['51job search', mkCmd('51job', 'search', '51job.com')],
      ['51job detail', mkCmd('51job', 'detail', '51job.com')],
      ['xueqiu search', mkCmd('xueqiu', 'search', 'xueqiu.com')],
    ]);
    const v = findNearestAdapter('https://jobs.51job.com/', reg);
    expect(v?.site).toBe('51job');
    expect(v?.example_commands).toContain('51job search');
  });

  it('falls back to site-name containment when no domain is registered', () => {
    const reg = new Map<string, CliCommand>([
      ['51job search', mkCmd('51job', 'search')],
    ]);
    const v = findNearestAdapter('https://we.51job.com/', reg);
    expect(v?.site).toBe('51job');
  });

  it('returns null when no adapter matches', () => {
    const reg = new Map<string, CliCommand>([
      ['xueqiu search', mkCmd('xueqiu', 'search', 'xueqiu.com')],
    ]);
    const v = findNearestAdapter('https://random-site.io/', reg);
    expect(v).toBeNull();
  });

  it('prefers the site with the most commands', () => {
    const reg = new Map<string, CliCommand>([
      ['a search', mkCmd('a', 'search', 'a.com')],
      ['b search', mkCmd('b', 'search', 'a.com')],
      ['b detail', mkCmd('b', 'detail', 'a.com')],
      ['b company', mkCmd('b', 'company', 'a.com')],
    ]);
    const v = findNearestAdapter('https://jobs.a.com/', reg);
    expect(v?.site).toBe('b');
  });
});

describe('analyzeSite', () => {
  it('recommends browser-context fetch when WAF is detected', () => {
    const report = analyzeSite(
      mkSignals({ cookieNames: ['acw_sc__v2'] }),
      new Map(),
    );
    expect(report.anti_bot.vendor).toBe('aliyun_waf');
    expect(report.recommended_next_step).toMatch(/browser context/i);
  });

  it('recommends reading SSR state when Pattern B fires', () => {
    const report = analyzeSite(
      mkSignals({
        initialState: { __INITIAL_STATE__: false, __NUXT__: true, __NEXT_DATA__: false, __APOLLO_STATE__: false },
      }),
      new Map(),
    );
    expect(report.pattern.pattern).toBe('B');
    expect(report.recommended_next_step).toMatch(/__NUXT__|__INITIAL_STATE__|__NEXT_DATA__/);
  });

  it('includes __APOLLO_STATE__ in Pattern B next-step guidance', () => {
    const report = analyzeSite(
      mkSignals({
        initialState: { __INITIAL_STATE__: false, __NUXT__: false, __NEXT_DATA__: false, __APOLLO_STATE__: true },
      }),
      new Map(),
    );
    expect(report.pattern.pattern).toBe('B');
    expect(report.recommended_next_step).toMatch(/__APOLLO_STATE__/);
  });

  it('includes nearest_adapter when the registry has a match', () => {
    const reg = new Map<string, CliCommand>([
      ['51job search', mkCmd('51job', 'search', '51job.com')],
    ]);
    const report = analyzeSite(
      mkSignals({ finalUrl: 'https://we.51job.com/' }),
      reg,
    );
    expect(report.nearest_adapter?.site).toBe('51job');
  });
});
