import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { wrapForEval } from '../../browser/utils.js';
import { getRegistry } from '../../registry.js';
import type { IPage } from '../../types.js';
import './draft.js';

function createPageMock(
  evaluateResults: unknown[],
  overrides: Partial<IPage> = {},
): IPage {
  const evaluate = vi.fn();
  for (const result of evaluateResults) {
    evaluate.mockResolvedValueOnce(result);
  }

  return {
    goto: vi.fn().mockResolvedValue(undefined),
    evaluate,
    getCookies: vi.fn().mockResolvedValue([]),
    snapshot: vi.fn().mockResolvedValue(undefined),
    click: vi.fn().mockResolvedValue(undefined),
    typeText: vi.fn().mockResolvedValue(undefined),
    pressKey: vi.fn().mockResolvedValue(undefined),
    scrollTo: vi.fn().mockResolvedValue(undefined),
    getFormState: vi.fn().mockResolvedValue({ forms: [], orphanFields: [] }),
    wait: vi.fn().mockResolvedValue(undefined),
    tabs: vi.fn().mockResolvedValue([]),
    closeTab: vi.fn().mockResolvedValue(undefined),
    newTab: vi.fn().mockResolvedValue(undefined),
    selectTab: vi.fn().mockResolvedValue(undefined),
    networkRequests: vi.fn().mockResolvedValue([]),
    consoleMessages: vi.fn().mockResolvedValue([]),
    scroll: vi.fn().mockResolvedValue(undefined),
    autoScroll: vi.fn().mockResolvedValue(undefined),
    installInterceptor: vi.fn().mockResolvedValue(undefined),
    getInterceptedRequests: vi.fn().mockResolvedValue([]),
    waitForCapture: vi.fn().mockResolvedValue(undefined),
    screenshot: vi.fn().mockResolvedValue(''),
    setFileInput: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('douyin draft registration', () => {
  it('registers the draft command', () => {
    const registry = getRegistry();
    const values = [...registry.values()];
    const cmd = values.find(c => c.site === 'douyin' && c.name === 'draft');
    expect(cmd).toBeDefined();
  });

  it('uploads through the official creator draft page and saves the draft session', async () => {
    const registry = getRegistry();
    const cmd = [...registry.values()].find(c => c.site === 'douyin' && c.name === 'draft');
    expect(cmd?.func).toBeTypeOf('function');
    if (!cmd?.func) throw new Error('douyin draft command not registered');

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-douyin-draft-'));
    const videoPath = path.join(tempDir, 'demo.mp4');
    fs.writeFileSync(videoPath, Buffer.from([0, 0, 0, 20, 102, 116, 121, 112]));

    const page = createPageMock(
      [
        undefined,
        { href: 'https://creator.douyin.com/creator-micro/content/post/video?enter_from=publish_page', ready: true, bodyText: '' },
        undefined,
        true,
        true,
        true,
        { ok: true, text: '暂存离开', creationId: 'creation-001' },
        {
          href: 'https://creator.douyin.com/creator-micro/content/upload?enter_from=publish',
          bodyText: '你还有上次未发布的视频，是否继续编辑？继续编辑放弃',
        },
      ],
    );

    const rows = await cmd.func(page, {
      video: videoPath,
      title: '最小修复验证',
      caption: 'opencli draft e2e',
      cover: '',
      visibility: 'friends',
    });

    expect(page.goto).toHaveBeenCalledWith(
      'https://creator.douyin.com/creator-micro/content/upload',
    );
    expect(page.wait).toHaveBeenCalledWith({
      selector: 'input[type="file"]',
      timeout: 20,
    });
    expect(page.setFileInput).toHaveBeenCalledWith([videoPath], 'input[type="file"]');

    const evaluateCalls = (page.evaluate as ReturnType<typeof vi.fn>).mock.calls.map(
      (args: unknown[]) => String(args[0]),
    );
    expect(evaluateCalls.some((code: string) => code.includes('填写作品标题'))).toBe(true);
    expect(evaluateCalls.some((code: string) => code.includes('好友可见'))).toBe(true);
    expect(evaluateCalls.some((code: string) => code.includes('暂存离开'))).toBe(true);

    expect(rows).toEqual([
      {
        status: '✅ 草稿已保存，可在创作中心继续编辑',
        draft_id: 'creation-001',
      },
    ]);
  });

  it('waits for the composer when upload processing is slower than the first few polls', async () => {
    const registry = getRegistry();
    const cmd = [...registry.values()].find(c => c.site === 'douyin' && c.name === 'draft');
    expect(cmd?.func).toBeTypeOf('function');
    if (!cmd?.func) throw new Error('douyin draft command not registered');

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-douyin-draft-'));
    const videoPath = path.join(tempDir, 'slow.mp4');
    fs.writeFileSync(videoPath, Buffer.from([0, 0, 0, 20, 102, 116, 121, 112]));

    const page = createPageMock(
      [
        undefined,
        { href: 'https://creator.douyin.com/creator-micro/content/upload', ready: false, bodyText: '上传中 42%' },
        { href: 'https://creator.douyin.com/creator-micro/content/upload', ready: false, bodyText: '转码中' },
        { href: 'https://creator.douyin.com/creator-micro/content/post/video?enter_from=publish_page', ready: true, bodyText: '' },
        undefined,
        true,
        true,
        { ok: true, text: '暂存离开', creationId: 'creation-slow' },
        {
          href: 'https://creator.douyin.com/creator-micro/content/upload?enter_from=publish',
          bodyText: '你还有上次未发布的视频，是否继续编辑？继续编辑放弃',
        },
      ],
    );

    const rows = await cmd.func(page, {
      video: videoPath,
      title: '慢上传验证',
      caption: '',
      cover: '',
      visibility: 'public',
    });

    expect(rows).toEqual([
      {
        status: '✅ 草稿已保存，可在创作中心继续编辑',
        draft_id: 'creation-slow',
      },
    ]);
    expect(page.wait).toHaveBeenCalledWith({ time: 0.5 });
    const shortWaitCalls = (page.wait as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([arg]) => JSON.stringify(arg) === JSON.stringify({ time: 0.5 }),
    );
    expect(shortWaitCalls).toHaveLength(2);
  });

  it('fails fast when the save action does not expose a draft creation id', async () => {
    const registry = getRegistry();
    const cmd = [...registry.values()].find(c => c.site === 'douyin' && c.name === 'draft');
    expect(cmd?.func).toBeTypeOf('function');
    if (!cmd?.func) throw new Error('douyin draft command not registered');

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-douyin-draft-'));
    const videoPath = path.join(tempDir, 'missing-id.mp4');
    fs.writeFileSync(videoPath, Buffer.from([0, 0, 0, 20, 102, 116, 121, 112]));

    const page = createPageMock(
      [
        undefined,
        { href: 'https://creator.douyin.com/creator-micro/content/post/video?enter_from=publish_page', ready: true, bodyText: '' },
        undefined,
        true,
        true,
        { ok: true, text: '暂存离开', creationId: '' },
      ],
    );

    await expect(
      cmd.func(page, {
        video: videoPath,
        title: '缺失 creation id',
        caption: '',
        cover: '',
        visibility: 'public',
      }),
    ).rejects.toThrow('点击草稿按钮失败: creation-id-missing');
  });

  it('uses the dedicated cover upload input when a custom cover is provided', async () => {
    const registry = getRegistry();
    const cmd = [...registry.values()].find(c => c.site === 'douyin' && c.name === 'draft');
    expect(cmd?.func).toBeTypeOf('function');
    if (!cmd?.func) throw new Error('douyin draft command not registered');

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-douyin-draft-'));
    const videoPath = path.join(tempDir, 'demo.mp4');
    const coverPath = path.join(tempDir, 'cover.jpg');
    fs.writeFileSync(videoPath, Buffer.from([0, 0, 0, 20, 102, 116, 121, 112]));
    fs.writeFileSync(coverPath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

    const page = createPageMock(
      [
        undefined,
        { href: 'https://creator.douyin.com/creator-micro/content/post/video?enter_from=publish_page', ready: true, bodyText: '' },
        undefined,
        1,
        { ok: false, reason: 'cover-input-pending' },
        { ok: true, selector: '[data-opencli-cover-input="1"]' },
        { titleReady: true, coverBusy: true, bodyText: '封面处理中' },
        { titleReady: true, coverBusy: false, bodyText: '上传新封面' },
        { titleReady: true, coverBusy: false, bodyText: '上传新封面' },
        true,
        true,
        { ok: true, text: '暂存离开', creationId: 'creation-002' },
        {
          href: 'https://creator.douyin.com/creator-micro/content/upload?enter_from=publish',
          bodyText: '你还有上次未发布的视频，是否继续编辑？继续编辑放弃',
        },
      ],
    );

    const rows = await cmd.func(page, {
      video: videoPath,
      title: '封面上传验证',
      caption: '',
      cover: coverPath,
      visibility: 'public',
    });

    expect(page.setFileInput).toHaveBeenNthCalledWith(1, [videoPath], 'input[type="file"]');
    expect(page.setFileInput).toHaveBeenNthCalledWith(2, [coverPath], '[data-opencli-cover-input="1"]');
    const shortWaitCalls = (page.wait as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([arg]) => JSON.stringify(arg) === JSON.stringify({ time: 0.5 }),
    );
    expect(shortWaitCalls).toHaveLength(3);

    const evaluateCalls = (page.evaluate as ReturnType<typeof vi.fn>).mock.calls.map(
      (args: unknown[]) => String(args[0]),
    );
    expect(evaluateCalls.some((code: string) => code.includes('上传新封面'))).toBe(true);
    expect(() => {
      for (const code of evaluateCalls) {
        new Function(wrapForEval(code));
      }
    }).not.toThrow();

    expect(rows).toEqual([
      {
        status: '✅ 草稿已保存，可在创作中心继续编辑',
        draft_id: 'creation-002',
      },
    ]);
  });

  it('waits for the cover state to stay idle even when busy appears after the first poll', async () => {
    const registry = getRegistry();
    const cmd = [...registry.values()].find(c => c.site === 'douyin' && c.name === 'draft');
    expect(cmd?.func).toBeTypeOf('function');
    if (!cmd?.func) throw new Error('douyin draft command not registered');

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-douyin-draft-'));
    const videoPath = path.join(tempDir, 'cover-race.mp4');
    const coverPath = path.join(tempDir, 'cover-race.jpg');
    fs.writeFileSync(videoPath, Buffer.from([0, 0, 0, 20, 102, 116, 121, 112]));
    fs.writeFileSync(coverPath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

    const page = createPageMock(
      [
        undefined,
        { href: 'https://creator.douyin.com/creator-micro/content/post/video?enter_from=publish_page', ready: true, bodyText: '' },
        undefined,
        1,
        { ok: true, selector: '[data-opencli-cover-input="1"]' },
        { titleReady: true, coverBusy: false, bodyText: '上传新封面' },
        { titleReady: true, coverBusy: true, bodyText: '封面处理中' },
        { titleReady: true, coverBusy: false, bodyText: '上传新封面' },
        { titleReady: true, coverBusy: false, bodyText: '上传新封面' },
        true,
        true,
        { ok: true, text: '暂存离开', creationId: 'creation-cover-race' },
        {
          href: 'https://creator.douyin.com/creator-micro/content/upload?enter_from=publish',
          bodyText: '你还有上次未发布的视频，是否继续编辑？继续编辑放弃',
        },
      ],
    );

    const rows = await cmd.func(page, {
      video: videoPath,
      title: '封面竞态验证',
      caption: '',
      cover: coverPath,
      visibility: 'public',
    });

    expect(rows).toEqual([
      {
        status: '✅ 草稿已保存，可在创作中心继续编辑',
        draft_id: 'creation-cover-race',
      },
    ]);
    const shortWaitCalls = (page.wait as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([arg]) => JSON.stringify(arg) === JSON.stringify({ time: 0.5 }),
    );
    expect(shortWaitCalls).toHaveLength(3);
  });
});
