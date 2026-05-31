import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
import './publish.js';

function createPageMock(overrides = {}) {
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(undefined),
    wait: vi.fn().mockResolvedValue(undefined),
    screenshot: vi.fn().mockResolvedValue(''),
    setFileInput: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeTempVideo(ext = '.mp4') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-wechat-channels-publish-'));
  const file = path.join(dir, `demo${ext}`);
  fs.writeFileSync(file, Buffer.from([0x00, 0x00, 0x00, 0x18]));
  return file;
}

describe('wechat-channels publish — registration', () => {
  it('is registered with the expected metadata', () => {
    const cmd = getRegistry().get('wechat-channels/publish');
    expect(cmd).toBeDefined();
    expect(cmd?.func).toBeTypeOf('function');
    expect(cmd?.access).toBe('write');
    expect(cmd?.domain).toBe('channels.weixin.qq.com');
    expect(cmd?.strategy).toBe('cookie');
  });

  it('declares video as the required positional argument', () => {
    const cmd = getRegistry().get('wechat-channels/publish');
    const video = cmd?.args.find((a) => a.name === 'video');
    expect(video?.positional).toBe(true);
    expect(video?.required).toBe(true);
  });

  it('exposes the documented optional flags', () => {
    const cmd = getRegistry().get('wechat-channels/publish');
    const names = new Set(cmd?.args.map((a) => a.name));
    for (const flag of ['title', 'caption', 'cover', 'schedule', 'draft', 'manual', 'timeout']) {
      expect(names.has(flag)).toBe(true);
    }
  });
});

describe('wechat-channels publish — input validation', () => {
  it('rejects a missing video file with ArgumentError', async () => {
    const cmd = getRegistry().get('wechat-channels/publish');
    const page = createPageMock();
    await expect(
      cmd.func(page, { video: '/no/such/file.mp4' }),
    ).rejects.toBeInstanceOf(ArgumentError);
    // Validation must fail before any navigation happens.
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('rejects an unsupported video format with ArgumentError', async () => {
    const cmd = getRegistry().get('wechat-channels/publish');
    const badFile = makeTempVideo('.mkv');
    const page = createPageMock();
    await expect(
      cmd.func(page, { video: badFile }),
    ).rejects.toBeInstanceOf(ArgumentError);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('rejects a missing cover file with ArgumentError', async () => {
    const cmd = getRegistry().get('wechat-channels/publish');
    const video = makeTempVideo('.mp4');
    const page = createPageMock();
    await expect(
      cmd.func(page, { video, cover: '/no/such/cover.png' }),
    ).rejects.toBeInstanceOf(ArgumentError);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('requires a browser page', async () => {
    const cmd = getRegistry().get('wechat-channels/publish');
    const video = makeTempVideo('.mp4');
    await expect(cmd.func(null, { video })).rejects.toThrow();
  });
});
