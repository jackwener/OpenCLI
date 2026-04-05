import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CliCommand } from '@jackwener/opencli/registry';
import { getRegistry } from '@jackwener/opencli/registry';
import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { createPageMock } from './test-utils.js';

// Mock download dependencies before importing the adapter
const { mockHttpDownload, mockMkdirSync } = vi.hoisted(() => ({
  mockHttpDownload: vi.fn(),
  mockMkdirSync: vi.fn(),
}));

vi.mock('@jackwener/opencli/download', () => ({
  formatCookieHeader: vi.fn().mockReturnValue('cookie=value'),
  httpDownload: mockHttpDownload,
}));

vi.mock('node:fs', () => ({
  mkdirSync: mockMkdirSync,
}));

// Now import the adapter (after mocks are set up)
await import('./download.js');

let cmd: CliCommand;

beforeAll(() => {
  cmd = getRegistry().get('pixiv/download')!;
  expect(cmd?.func).toBeTypeOf('function');
});

describe('pixiv download', () => {
  beforeEach(() => {
    mockHttpDownload.mockReset();
    mockMkdirSync.mockReset();
  });

  it('throws CommandExecutionError on invalid illust ID', async () => {
    const page = createPageMock([]);

    await expect(cmd.func!(page, { 'illust-id': 'abc', output: '/tmp/test' })).rejects.toThrow(CommandExecutionError);
  });

  it('throws AuthRequiredError on 403', async () => {
    const page = createPageMock([{ __httpError: 403 }]);

    await expect(cmd.func!(page, { 'illust-id': '12345', output: '/tmp/test' })).rejects.toThrow(AuthRequiredError);
  });

  it('throws CommandExecutionError on 404', async () => {
    const page = createPageMock([{ __httpError: 404 }]);

    await expect(cmd.func!(page, { 'illust-id': '12345', output: '/tmp/test' })).rejects.toThrow(CommandExecutionError);
  });

  it('throws CommandExecutionError on non-auth HTTP failure', async () => {
    const page = createPageMock([{ __httpError: 500 }]);

    await expect(cmd.func!(page, { 'illust-id': '12345', output: '/tmp/test' })).rejects.toThrow(CommandExecutionError);
  });

  it('returns failure when no images found', async () => {
    const page = createPageMock([{ body: [] }]);

    const result = (await cmd.func!(page, { 'illust-id': '12345', output: '/tmp/test' })) as any[];
    expect(result).toEqual([{ index: 0, type: '-', status: 'failed', size: 'No images found' }]);
  });

  it('downloads images with Referer header', async () => {
    mockHttpDownload.mockResolvedValue({ success: true, size: 1024000 });

    const page = createPageMock([
      {
        body: [
          { urls: { original: 'https://i.pximg.net/img-original/img/2025/01/01/00/00/00/12345_p0.png' } },
          { urls: { original: 'https://i.pximg.net/img-original/img/2025/01/01/00/00/00/12345_p1.jpg' } },
        ],
      },
    ]);

    const result = (await cmd.func!(page, { 'illust-id': '12345', output: '/tmp/test' })) as any[];

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ index: 1, type: 'image', status: 'success' });
    expect(result[1]).toMatchObject({ index: 2, type: 'image', status: 'success' });

    // Verify Referer header was passed
    expect(mockHttpDownload).toHaveBeenCalledTimes(2);
    const firstCallOpts = mockHttpDownload.mock.calls[0][2];
    expect(firstCallOpts.headers).toEqual({ Referer: 'https://www.pixiv.net/' });
  });

  it('handles individual download failures gracefully', async () => {
    mockHttpDownload
      .mockResolvedValueOnce({ success: true, size: 512000 })
      .mockRejectedValueOnce(new Error('Connection timeout'));

    const page = createPageMock([
      {
        body: [
          { urls: { original: 'https://i.pximg.net/img/12345_p0.png' } },
          { urls: { original: 'https://i.pximg.net/img/12345_p1.png' } },
        ],
      },
    ]);

    const result = (await cmd.func!(page, { 'illust-id': '12345', output: '/tmp/test' })) as any[];

    expect(result).toHaveLength(2);
    expect(result[0].status).toBe('success');
    expect(result[1].status).toBe('failed');
    expect(result[1].size).toBe('Connection timeout');
  });
});
