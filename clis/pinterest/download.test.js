import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { createPageMock } from '../test-utils.js';

// Mock download + fs dependencies before importing the adapter.
const { mockHttpDownload, mockMkdirSync } = vi.hoisted(() => ({
  mockHttpDownload: vi.fn(),
  mockMkdirSync: vi.fn(),
}));
vi.mock('@jackwener/opencli/download', () => ({ httpDownload: mockHttpDownload }));
vi.mock('@jackwener/opencli/download/progress', () => ({ formatBytes: (n) => `${n}B` }));
vi.mock('node:fs', () => ({ mkdirSync: mockMkdirSync }));

await import('./download.js');

let cmd;

function pinDetail(overrides = {}) {
  return {
    resource_response: {
      data: { id: '1234567890123456', images: { orig: { url: 'https://i.pinimg.com/originals/a/b/c.png' } }, ...overrides },
    },
  };
}

beforeAll(() => {
  cmd = getRegistry().get('pinterest/download');
  expect(cmd?.func).toBeTypeOf('function');
});

describe('pinterest download', () => {
  beforeEach(() => {
    mockHttpDownload.mockReset();
    mockMkdirSync.mockReset();
  });

  it('throws ArgumentError on a non-pin reference', async () => {
    await expect(cmd.func(createPageMock([]), { pin: 'nope', output: '/tmp/x' })).rejects.toThrow(ArgumentError);
  });

  it('throws EmptyResultError when the pin is missing', async () => {
    const page = createPageMock([{ resource_response: { data: {} } }]);
    await expect(cmd.func(page, { pin: '123', output: '/tmp/x' })).rejects.toThrow(EmptyResultError);
  });

  it('throws CommandExecutionError when the pin has no image', async () => {
    const page = createPageMock([pinDetail({ images: {} })]);
    await expect(cmd.func(page, { pin: '123', output: '/tmp/x' })).rejects.toThrow(CommandExecutionError);
  });

  it('downloads the original image and returns a success row', async () => {
    mockHttpDownload.mockResolvedValue({ success: true, size: 2048 });
    const page = createPageMock([pinDetail()]);
    const result = await cmd.func(page, { pin: 'https://www.pinterest.com/pin/1234567890123456/', output: '/tmp/x' });
    expect(result[0]).toMatchObject({ pinId: '1234567890123456', status: 'success', size: '2048B' });
    expect(result[0].path).toMatch(/1234567890123456\.png$/);
    expect(mockHttpDownload).toHaveBeenCalledTimes(1);
    expect(mockMkdirSync).toHaveBeenCalledWith('/tmp/x', { recursive: true });
  });

  it('throws CommandExecutionError when the download fails', async () => {
    mockHttpDownload.mockResolvedValue({ success: false, error: 'network' });
    const page = createPageMock([pinDetail()]);
    await expect(cmd.func(page, { pin: '1234567890123456', output: '/tmp/x' })).rejects.toThrow(CommandExecutionError);
  });
});
