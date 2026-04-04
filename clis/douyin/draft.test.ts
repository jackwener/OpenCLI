import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterAll, describe, expect, it, vi } from 'vitest';

import { wrapForEval } from '../../browser/utils.js';
import { getRegistry } from '../../src/registry.js';
import type { IPage } from '../../src/types.js';
import { buildCoverCheckPanelTextJs } from './draft.js';

// ─── Shared test helpers ────────────────────────────────────────────

const tempDirs: string[] = [];

function createTempVideo(name = 'demo.mp4'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-douyin-draft-'));
  tempDirs.push(dir);
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, Buffer.from([0, 0, 0, 20, 102, 116, 121, 112]));
  return filePath;
}

function createTempCover(videoPath: string, name = 'cover.jpg'): string {
  const filePath = path.join(path.dirname(videoPath), name);
  fs.writeFileSync(filePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  return filePath;
}

function getDraftCommand() {
  const registry = getRegistry();
  const cmd = [...registry.values()].find(c => c.site === 'douyin' && c.name === 'draft');
  if (!cmd?.func) throw new Error('douyin draft command not registered');
  return cmd as typeof cmd & { func: NonNullable<typeof cmd.func> };
}

afterAll(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

type FakeNode = {
  textContent: string;
  parentElement: FakeNode | null;
  querySelectorAll: (_selector: string) => FakeNode[];
};

function createFakeTree(text: string, children: FakeNode[] = []): FakeNode {
  const node: FakeNode = {
    textContent: text,
    parentElement: null,
    querySelectorAll: () => [],
  };
  node.querySelectorAll = () => {
    const descendants: FakeNode[] = [];
    for (const child of children) {
      descendants.push(child, ...child.querySelectorAll('*'));
    }
    return descendants;
  };
  for (const child of children) {
    child.parentElement = node;
  }
  return node;
}

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

  it('extracts the higher quick-check panel instead of stopping at a header-only ancestor', () => {
    const marker = createFakeTree('快速检测');
    const state = createFakeTree('重新检测');
    const header = createFakeTree('快速检测', [marker]);
    const status = createFakeTree('重新检测', [state]);
    const panel = createFakeTree('快速检测重新检测', [header, status]);
    const body = createFakeTree('body', [panel]);

    const g = globalThis as unknown as {
      document?: { body: FakeNode; querySelectorAll: (_selector: string) => FakeNode[] };
    };
    const originalDocument = g.document;
    g.document = {
      body,
      querySelectorAll: () => [marker, state],
    };

    try {
      expect((eval(buildCoverCheckPanelTextJs()) as () => string)()).toBe('快速检测重新检测');
    } finally {
      g.document = originalDocument;
    }
  });

  it('returns empty when only header text exists and no exact quick-check state node is present', () => {
    const marker = createFakeTree('快速检测');
    const note = createFakeTree('检测说明');
    const header = createFakeTree('快速检测检测说明', [marker, note]);
    const body = createFakeTree('body', [header]);

    const g = globalThis as unknown as {
      document?: { body: FakeNode; querySelectorAll: (_selector: string) => FakeNode[] };
    };
    const originalDocument = g.document;
    g.document = {
      body,
      querySelectorAll: () => [marker, note],
    };

    try {
      expect((eval(buildCoverCheckPanelTextJs()) as () => string)()).toBe('');
    } finally {
      g.document = originalDocument;
    }
  });

  it('extracts the quick-check panel when busy state is rendered as a single 封面检测中 node', () => {
    const marker = createFakeTree('快速检测');
    const busy = createFakeTree('封面检测中');
    const header = createFakeTree('快速检测', [marker]);
    const status = createFakeTree('封面检测中', [busy]);
    const panel = createFakeTree('快速检测封面检测中', [header, status]);
    const body = createFakeTree('body', [panel]);

    const g = globalThis as unknown as {
      document?: { body: FakeNode; querySelectorAll: (_selector: string) => FakeNode[] };
    };
    const originalDocument = g.document;
    g.document = {
      body,
      querySelectorAll: () => [marker, busy],
    };

    try {
      expect((eval(buildCoverCheckPanelTextJs()) as () => string)()).toBe('快速检测封面检测中');
    } finally {
      g.document = originalDocument;
    }
  });

  it('uploads through the official creator draft page and saves the draft session', async () => {
    const cmd = getDraftCommand();
    const videoPath = createTempVideo('demo.mp4');

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
    const cmd = getDraftCommand();
    const videoPath = createTempVideo('slow.mp4');

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
    const cmd = getDraftCommand();
    const videoPath = createTempVideo('missing-id.mp4');

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
    const cmd = getDraftCommand();
    const videoPath = createTempVideo('demo.mp4');
    const coverPath = createTempCover(videoPath);

    const page = createPageMock(
      [
        undefined,
        { href: 'https://creator.douyin.com/creator-micro/content/post/video?enter_from=publish_page', ready: true, bodyText: '' },
        undefined,
        1,
        { ok: false, reason: 'cover-input-pending' },
        { ok: true, selector: '[data-opencli-cover-input="1"]' },
        '快速检测检测中',
        '快速检测重新检测',
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
    expect(shortWaitCalls).toHaveLength(2);

    const evaluateCalls = (page.evaluate as ReturnType<typeof vi.fn>).mock.calls.map(
      (args: unknown[]) => String(args[0]),
    );
    expect(evaluateCalls.some((code: string) => code.includes('上传新封面'))).toBe(true);
    expect(evaluateCalls.some((code: string) => code.includes("text.includes('快速检测检测')"))).toBe(false);
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

  it('waits for a late cover-section update before treating the custom cover as ready', async () => {
    const cmd = getDraftCommand();
    const videoPath = createTempVideo('cover-race.mp4');
    const coverPath = createTempCover(videoPath, 'cover-race.jpg');

    const page = createPageMock(
      [
        undefined,
        { href: 'https://creator.douyin.com/creator-micro/content/post/video?enter_from=publish_page', ready: true, bodyText: '' },
        undefined,
        1,
        { ok: true, selector: '[data-opencli-cover-input="1"]' },
        '快速检测重新检测',
        '快速检测重新检测',
        '快速检测重新检测',
        '快速检测检测中',
        '快速检测横/竖双封面缺失',
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
    expect(shortWaitCalls).toHaveLength(4);
  });

  it('accepts the same ready label after cover busy state when the quick-check panel actually transitioned', async () => {
    const cmd = getDraftCommand();
    const videoPath = createTempVideo('cover-same-ready.mp4');
    const coverPath = createTempCover(videoPath, 'cover-same-ready.jpg');

    const page = createPageMock(
      [
        undefined,
        { href: 'https://creator.douyin.com/creator-micro/content/post/video?enter_from=publish_page', ready: true, bodyText: '' },
        undefined,
        1,
        { ok: true, selector: '[data-opencli-cover-input="1"]' },
        '快速检测重新检测',
        '快速检测重新检测',
        '快速检测检测中',
        '快速检测重新检测',
        true,
        true,
        { ok: true, text: '暂存离开', creationId: 'creation-cover-same-ready' },
        {
          href: 'https://creator.douyin.com/creator-micro/content/upload?enter_from=publish',
          bodyText: '你还有上次未发布的视频，是否继续编辑？继续编辑放弃',
        },
      ],
    );

    const rows = await cmd.func(page, {
      video: videoPath,
      title: '封面同文案验证',
      caption: '',
      cover: coverPath,
      visibility: 'public',
    });

    expect(rows).toEqual([
      {
        status: '✅ 草稿已保存，可在创作中心继续编辑',
        draft_id: 'creation-cover-same-ready',
      },
    ]);
    const shortWaitCalls = (page.wait as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([arg]) => JSON.stringify(arg) === JSON.stringify({ time: 0.5 }),
    );
    expect(shortWaitCalls).toHaveLength(3);
  });
});
