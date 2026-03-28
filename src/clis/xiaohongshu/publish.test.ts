import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { getRegistry } from '../../registry.js';
import type { IPage } from '../../types.js';
import './publish.js';

function createPageMock(evaluateResults: any[]): IPage {
  const evaluate = vi.fn();
  for (const result of evaluateResults) {
    evaluate.mockResolvedValueOnce(result);
  }

  return {
    goto: vi.fn().mockResolvedValue(undefined),
    evaluate,
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
    getCookies: vi.fn().mockResolvedValue([]),
    screenshot: vi.fn().mockResolvedValue(''),
    waitForCapture: vi.fn().mockResolvedValue(undefined),
  };
}

describe('xiaohongshu publish', () => {
  it('selects the image-text tab and publishes successfully', async () => {
    const cmd = getRegistry().get('xiaohongshu/publish');
    expect(cmd?.func).toBeTypeOf('function');

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-xhs-publish-'));
    const imagePath = path.join(tempDir, 'demo.jpg');
    fs.writeFileSync(imagePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

    const page = createPageMock([
      'https://creator.xiaohongshu.com/publish/publish?from=menu_left',
      { ok: true, target: '上传图文', text: '上传图文' },
      { state: 'editor_ready', hasTitleInput: true, hasImageInput: true, hasVideoSurface: false },
      { ok: true, count: 1 },
      false,
      true, // waitForEditForm: editor appeared
      { ok: true, sel: 'input[maxlength="20"]' },
      { ok: true, sel: '[contenteditable="true"][class*="content"]' },
      true,
      'https://creator.xiaohongshu.com/publish/success',
      '发布成功',
    ]);

    const result = await cmd!.func!(page, {
      title: 'DeepSeek别乱问',
      content: '一篇真实一点的小红书正文',
      images: imagePath,
      topics: '',
      draft: false,
    });

    const evaluateCalls = (page.evaluate as any).mock.calls.map((args: any[]) => String(args[0]));
    expect(evaluateCalls.some((code: string) => code.includes("const targets = ['上传图文', '图文', '图片']"))).toBe(true);
    expect(evaluateCalls.some((code: string) => code.includes("No image file input found on page"))).toBe(true);
    expect(result).toEqual([
      {
        status: '✅ 发布成功',
        detail: '"DeepSeek别乱问" · 1张图片 · 发布成功',
      },
    ]);
  });

  it('fails early with a clear error when still on the video page', async () => {
    const cmd = getRegistry().get('xiaohongshu/publish');
    expect(cmd?.func).toBeTypeOf('function');

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-xhs-publish-'));
    const imagePath = path.join(tempDir, 'demo.jpg');
    fs.writeFileSync(imagePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

    const page = createPageMock([
      'https://creator.xiaohongshu.com/publish/publish?from=menu_left',
      { ok: false, visibleTexts: ['上传视频', '上传图文'] },
      { state: 'video_surface', hasTitleInput: false, hasImageInput: false, hasVideoSurface: true },
      { state: 'video_surface', hasTitleInput: false, hasImageInput: false, hasVideoSurface: true },
      { state: 'video_surface', hasTitleInput: false, hasImageInput: false, hasVideoSurface: true },
      { state: 'video_surface', hasTitleInput: false, hasImageInput: false, hasVideoSurface: true },
    ]);

    await expect(cmd!.func!(page, {
      title: 'DeepSeek别乱问',
      content: '一篇真实一点的小红书正文',
      images: imagePath,
      topics: '',
      draft: false,
    })).rejects.toThrow('Still on the video publish page after trying to select 图文');

    expect(page.screenshot).toHaveBeenCalledWith({ path: '/tmp/xhs_publish_tab_debug.png' });
  });

  it('waits for the image-text surface to appear after clicking the tab', async () => {
    const cmd = getRegistry().get('xiaohongshu/publish');
    expect(cmd?.func).toBeTypeOf('function');

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-xhs-publish-'));
    const imagePath = path.join(tempDir, 'demo.jpg');
    fs.writeFileSync(imagePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

    const page = createPageMock([
      'https://creator.xiaohongshu.com/publish/publish?from=menu_left',
      { ok: true, target: '上传图文', text: '上传图文' },
      { state: 'video_surface', hasTitleInput: false, hasImageInput: false, hasVideoSurface: true },
      { state: 'editor_ready', hasTitleInput: true, hasImageInput: true, hasVideoSurface: false },
      { ok: true, count: 1 }, // injectImages
      false, // waitForUploads: no progress indicator
      true, // waitForEditForm: editor appeared
      { ok: true, sel: 'input[maxlength="20"]' },
      { ok: true, sel: '[contenteditable="true"][class*="content"]' },
      true,
      'https://creator.xiaohongshu.com/publish/success',
      '发布成功',
    ]);

    const result = await cmd!.func!(page, {
      title: '延迟切换也能过',
      content: '图文页切换慢一点也继续等',
      images: imagePath,
      topics: '',
      draft: false,
    });

    expect((page.wait as any).mock.calls).toContainEqual([{ time: 0.5 }]);
    expect(result).toEqual([
      {
        status: '✅ 发布成功',
        detail: '"延迟切换也能过" · 1张图片 · 发布成功',
      },
    ]);
  });
});
