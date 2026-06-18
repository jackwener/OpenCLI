import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandExecutionError } from '@jackwener/opencli/errors';

const { mockApiGet } = vi.hoisted(() => ({
  mockApiGet: vi.fn(),
}));

vi.mock('./utils.js', async (importOriginal) => ({
  ...(await importOriginal()),
  apiGet: mockApiGet,
}));

import { getRegistry } from '@jackwener/opencli/registry';
import './video.js';

describe('bilibili video', () => {
  const command = getRegistry().get('bilibili/video');
  const page = {
    goto: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn(),
  };

  beforeEach(() => {
    mockApiGet.mockReset();
    page.goto.mockClear();
    page.evaluate.mockReset();
  });

  it('returns a field/value table of video metadata on success', async () => {
    mockApiGet.mockResolvedValueOnce({
      code: 0,
      data: {
        bvid: 'BV1xx411c7mD',
        aid: 12345678,
        title: '三层结构笔记法',
        tname: '教程',
        pubdate: 1775053078, // 2026-04-01 14:17:58 UTC
        duration: 434,
        videos: 1,
        pic: 'https://i1.hdslb.com/some.jpg',
        desc: 'Obsidian 教程',
        rights: {},
        owner: { mid: 507578555, name: 'IOI科技' },
        stat: { view: 6128, danmaku: 0, reply: 21, like: 162, coin: 48, favorite: 564, share: 26 },
      },
    });

    const rows = await command.func(page, { bvid: 'BV1xx411c7mD' });

    // Every row has { field, value }
    expect(Array.isArray(rows)).toBe(true);
    for (const row of rows) {
      expect(row).toHaveProperty('field');
      expect(row).toHaveProperty('value');
    }

    const byField = Object.fromEntries(rows.map((r) => [r.field, r.value]));
    expect(byField.bvid).toBe('BV1xx411c7mD');
    expect(byField.title).toBe('三层结构笔记法');
    expect(byField.author).toBe('IOI科技 (mid: 507578555)');
    expect(byField.duration).toBe('7m14s (434s)');
    expect(byField.view).toBe('6128');
    expect(byField.like).toBe('162');
    // 普通视频：无任何付费标记
    expect(byField.requires_payment).toBe('false');
    expect(byField.payment_type).toBe('');
    expect(byField.pay_preview).toBe('false');
    expect(byField.redirect_url).toBe('');

    // Navigation primes the session
    expect(page.goto).toHaveBeenCalledWith('https://www.bilibili.com/video/BV1xx411c7mD/');
    // API called without signing
    expect(mockApiGet).toHaveBeenCalledWith(page, '/x/web-interface/view', { params: { bvid: 'BV1xx411c7mD' } });
  });

  it('throws CommandExecutionError when bilibili view API returns non-zero code', async () => {
    mockApiGet.mockResolvedValueOnce({
      code: -404,
      message: '啥都木有',
      data: null,
    });

    await expect(command.func(page, { bvid: 'BV1xx411c7mD' })).rejects.toSatisfy(
      (err) => err instanceof CommandExecutionError && /啥都木有|-404/.test(err.message),
    );
  });

  it('unwraps Browser Bridge envelopes before reading view API data', async () => {
    mockApiGet.mockResolvedValueOnce({
      session: 'browser:default',
      data: {
        code: 0,
        data: { bvid: 'BV1xx411c7mD', stat: {}, owner: {}, desc: '', rights: { pay: 1 } },
      },
    });

    const rows = await command.func(page, { bvid: 'BV1xx411c7mD' });
    const byField = Object.fromEntries(rows.map((r) => [r.field, r.value]));

    expect(byField.requires_payment).toBe('true');
    expect(byField.payment_type).toBe('vip');
  });

  it('extracts BV ID from full bilibili.com URL input', async () => {
    mockApiGet.mockResolvedValueOnce({
      code: 0,
      data: { bvid: 'BV1xx411c7mD', stat: {}, owner: {}, desc: '', rights: {} },
    });

    await command.func(page, { bvid: 'https://www.bilibili.com/video/BV1xx411c7mD/' });

    expect(page.goto).toHaveBeenCalledWith('https://www.bilibili.com/video/BV1xx411c7mD/');
    expect(mockApiGet).toHaveBeenCalledWith(page, '/x/web-interface/view', { params: { bvid: 'BV1xx411c7mD' } });
  });

  it('extracts BV ID from bilibili URL with trailing query string', async () => {
    mockApiGet.mockResolvedValueOnce({
      code: 0,
      data: { bvid: 'BV1Je9EBnEha', stat: {}, owner: {}, desc: '', rights: {} },
    });

    await command.func(page, {
      bvid: 'https://www.bilibili.com/video/BV1Je9EBnEha/?spm_id_from=333.1007&vd_source=abc',
    });

    expect(mockApiGet).toHaveBeenCalledWith(page, '/x/web-interface/view', { params: { bvid: 'BV1Je9EBnEha' } });
  });

  it('extracts BV ID from m.bilibili.com mobile URL', async () => {
    mockApiGet.mockResolvedValueOnce({
      code: 0,
      data: { bvid: 'BV1xx411c7mD', stat: {}, owner: {}, desc: '', rights: {} },
    });

    await command.func(page, { bvid: 'https://m.bilibili.com/video/BV1xx411c7mD' });

    expect(mockApiGet).toHaveBeenCalledWith(page, '/x/web-interface/view', { params: { bvid: 'BV1xx411c7mD' } });
  });

  it('flags member-only bangumi episode as vip paid content', async () => {
    // 实测数据形状：会员番剧单集（如 国王排名 02）view API 返回 rights.pay=1
    // + redirect_url 指向 bangumi ep 页
    mockApiGet.mockResolvedValueOnce({
      code: 0,
      data: {
        bvid: 'BV1HR4y1J7Sp',
        title: '【10月】国王排名 02【独家正版】',
        stat: {},
        owner: {},
        desc: '',
        rights: { pay: 1, hd5: 1 },
        redirect_url: 'https://www.bilibili.com/bangumi/play/ep424606',
      },
    });

    const rows = await command.func(page, { bvid: 'BV1HR4y1J7Sp' });
    const byField = Object.fromEntries(rows.map((r) => [r.field, r.value]));
    expect(byField.requires_payment).toBe('true');
    expect(byField.payment_type).toBe('vip');
    expect(byField.redirect_url).toBe('https://www.bilibili.com/bangumi/play/ep424606');
  });

  it('flags upower-exclusive video and ugc_pay preview', async () => {
    mockApiGet.mockResolvedValueOnce({
      code: 0,
      data: {
        bvid: 'BV1xx411c7mD',
        stat: {},
        owner: {},
        desc: '',
        rights: { ugc_pay_preview: 1 },
        is_upower_exclusive: true,
      },
    });

    const rows = await command.func(page, { bvid: 'BV1xx411c7mD' });
    const byField = Object.fromEntries(rows.map((r) => [r.field, r.value]));
    expect(byField.requires_payment).toBe('true');
    expect(byField.payment_type).toBe('upower');
    expect(byField.pay_preview).toBe('true');
  });

  it('flags ugc_pay video', async () => {
    mockApiGet.mockResolvedValueOnce({
      code: 0,
      data: { bvid: 'BV1xx411c7mD', stat: {}, owner: {}, desc: '', rights: { ugc_pay: 1 } },
    });

    const rows = await command.func(page, { bvid: 'BV1xx411c7mD' });
    const byField = Object.fromEntries(rows.map((r) => [r.field, r.value]));
    expect(byField.requires_payment).toBe('true');
    expect(byField.payment_type).toBe('ugc_pay');
  });

  it('typed-fails when paid marker source fields are missing', async () => {
    mockApiGet.mockResolvedValueOnce({
      code: 0,
      data: { bvid: 'BV1xx411c7mD', stat: {}, owner: {}, desc: '' },
    });

    await expect(command.func(page, { bvid: 'BV1xx411c7mD' })).rejects.toBeInstanceOf(CommandExecutionError);
  });

  it('typed-fails malformed paid marker flags instead of defaulting to free', async () => {
    mockApiGet.mockResolvedValueOnce({
      code: 0,
      data: { bvid: 'BV1xx411c7mD', stat: {}, owner: {}, desc: '', rights: { pay: '0' } },
    });

    await expect(command.func(page, { bvid: 'BV1xx411c7mD' })).rejects.toBeInstanceOf(CommandExecutionError);
  });

  it('returns full description without truncation or whitespace collapse', async () => {
    const longDesc = '第一行描述\n\n第二段，有多个空格   和换行\n\n' + 'x'.repeat(500);
    mockApiGet.mockResolvedValueOnce({
      code: 0,
      data: { bvid: 'BV1xx411c7mD', stat: {}, owner: {}, desc: longDesc, rights: {} },
    });

    const rows = await command.func(page, { bvid: 'BV1xx411c7mD' });
    const byField = Object.fromEntries(rows.map((r) => [r.field, r.value]));
    // JSON/YAML consumers must receive the complete description verbatim,
    // including original whitespace and length > 200 chars.
    expect(byField.description).toBe(longDesc);
    expect(byField.description.length).toBeGreaterThan(200);
  });
});
