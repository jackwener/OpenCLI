import { describe, expect, it } from 'vitest';

async function loadModule() {
  return import('./clis/weixin/download.js');
}

describe('weixin publish time extraction', () => {
  it('prefers publish_time text over create_time-like date strings', async () => {
    const mod = await loadModule();

    expect(mod.extractWechatPublishTime(
      '2026年3月24日 22:38',
      'var create_time = "2026年3月24日 22:38";',
    )).toBe('2026年3月24日 22:38');
  });

  it('falls back to unix timestamp create_time values', async () => {
    const mod = await loadModule();

    expect(mod.extractWechatPublishTime(
      '',
      'var create_time = "1711291080";',
    )).toBe('2024-03-24 22:38:00');
  });

  it('rejects malformed create_time values', async () => {
    const mod = await loadModule();

    expect(mod.extractWechatPublishTime(
      '',
      'var create_time = "2026年3月24日 22:38";',
    )).toBe('');
    expect(mod.extractWechatPublishTime(
      '',
      'var create_time = "1711291080abc";',
    )).toBe('');
    expect(mod.extractWechatPublishTime(
      '',
      'var create_time = "17112910800";',
    )).toBe('');
  });

  it('builds a self-contained browser helper that matches fallback behavior', async () => {
    const mod = await loadModule();

    const extractInPage = eval(mod.buildExtractWechatPublishTimeJs()) as (publishTimeText: string, htmlStr: string) => string;

    expect(extractInPage(
      '',
      'var create_time = "1711291080";',
    )).toBe('2024-03-24 22:38:00');
  });

  it('browser helper still prefers DOM publish_time text', async () => {
    const mod = await loadModule();

    const extractInPage = eval(mod.buildExtractWechatPublishTimeJs()) as (publishTimeText: string, htmlStr: string) => string;

    expect(extractInPage(
      '2026年3月24日 22:38',
      'var create_time = "1711291080";',
    )).toBe('2026年3月24日 22:38');
  });
});
