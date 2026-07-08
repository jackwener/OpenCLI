import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CommandExecutionError } from '@jackwener/opencli/errors';

const { mockPrepare } = vi.hoisted(() => ({
  mockPrepare: vi.fn(),
}));

vi.mock('./utils.js', async (importOriginal) => ({
  ...(await importOriginal()),
  prepareYoutubeApiPage: mockPrepare,
}));

import { getRegistry } from '@jackwener/opencli/registry';
import './video.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const videoSource = readFileSync(resolve(__dirname, 'video.js'), 'utf8');

describe('youtube video source contract', () => {
  it('extracts playability gate signals inside the watch bootstrap evaluate', () => {
    // 会员专享视频 metadata 照常可见但流不可播——playabilityStatus 是判断依据；
    // reason 文本本地化，membersOnly 必须用 locale 无关的徽标枚举判定。
    expect(videoSource).toContain('player.playabilityStatus');
    expect(videoSource).toContain('BADGE_STYLE_TYPE_MEMBERS_ONLY');
  });
});

describe('youtube video row mapping', () => {
  const command = getRegistry().get('youtube/video');
  const page = { evaluate: vi.fn() };

  beforeEach(() => {
    mockPrepare.mockReset().mockResolvedValue(undefined);
    page.evaluate.mockReset();
  });

  it('surfaces playabilityStatus / playabilityReason / membersOnly as rows', async () => {
    page.evaluate.mockResolvedValueOnce({
      title: 'Koji杨远骋：高手如何用AI？',
      channel: '课代表立正',
      videoId: 'jgeqHyFzfIM',
      playabilityStatus: 'UNPLAYABLE',
      playabilityReason: "This video is available to this channel's members",
      membersOnly: true,
    });

    const rows = await command.func(page, { url: 'https://www.youtube.com/watch?v=jgeqHyFzfIM' });
    const byField = Object.fromEntries(rows.map((r) => [r.field, r.value]));

    expect(byField.playabilityStatus).toBe('UNPLAYABLE');
    expect(byField.membersOnly).toBe('true');
    expect(byField.playabilityReason).toContain('members');
    // metadata 行照常返回（会员视频标题等仍可见）
    expect(byField.title).toBe('Koji杨远骋：高手如何用AI？');
  });

  it('reports OK playability for a normal video', async () => {
    page.evaluate.mockResolvedValueOnce({
      title: 'normal',
      playabilityStatus: 'OK',
      playabilityReason: '',
      membersOnly: false,
    });

    const rows = await command.func(page, { url: 'dQw4w9WgXcQ' });
    const byField = Object.fromEntries(rows.map((r) => [r.field, r.value]));

    expect(byField.playabilityStatus).toBe('OK');
    expect(byField.membersOnly).toBe('false');
  });

  it('unwraps Browser Bridge envelopes before row mapping', async () => {
    page.evaluate.mockResolvedValueOnce({
      session: 'browser:default',
      data: {
        title: 'normal',
        playabilityStatus: 'OK',
        playabilityReason: '',
        membersOnly: false,
      },
    });

    const rows = await command.func(page, { url: 'dQw4w9WgXcQ' });
    const byField = Object.fromEntries(rows.map((r) => [r.field, r.value]));

    expect(byField.title).toBe('normal');
    expect(byField.playabilityStatus).toBe('OK');
  });

  it('typed-fails when playability marker fields are missing', async () => {
    page.evaluate.mockResolvedValueOnce({
      title: 'unknown',
    });

    await expect(command.func(page, { url: 'dQw4w9WgXcQ' })).rejects.toBeInstanceOf(CommandExecutionError);
  });

  it('typed-fails malformed membersOnly instead of defaulting to false', async () => {
    page.evaluate.mockResolvedValueOnce({
      title: 'unknown',
      playabilityStatus: 'OK',
      playabilityReason: '',
      membersOnly: 'false',
    });

    await expect(command.func(page, { url: 'dQw4w9WgXcQ' })).rejects.toBeInstanceOf(CommandExecutionError);
  });
});
