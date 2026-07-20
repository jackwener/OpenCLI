import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { createPageMock } from '../test-utils.js';

const { mockMkdirSync, mockWriteFileSync } = vi.hoisted(() => ({
  mockMkdirSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
}));

vi.mock('node:fs', () => ({
  mkdirSync: mockMkdirSync,
  writeFileSync: mockWriteFileSync,
}));

await import('./novel-download.js');

let cmd;

beforeAll(() => {
  cmd = getRegistry().get('pixiv/novel-download');
  expect(cmd?.func).toBeTypeOf('function');
});

describe('pixiv novel-download', () => {
  beforeEach(() => {
    mockMkdirSync.mockReset();
    mockWriteFileSync.mockReset();
  });

  it('throws ArgumentError on invalid novel ID before navigation', async () => {
    const page = createPageMock([]);
    await expect(cmd.func(page, { 'novel-id': 'abc' })).rejects.toThrow(ArgumentError);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('throws AuthRequiredError on 403', async () => {
    const page = createPageMock([{ __httpError: 403 }]);
    await expect(cmd.func(page, { 'novel-id': '10588915' })).rejects.toThrow(AuthRequiredError);
  });

  it('writes a txt file with metadata and full novel content', async () => {
    const page = createPageMock([{ body: {
      id: '10588915', title: '星之观测手记', userName: '示例作者', userId: '37119297',
      content: '第一行\n第二行', tags: { tags: [{ tag: '一般' }, { tag: '中文' }] },
      createDate: '2019-01-06T12:48:16+00:00', bookmarkCount: 2829, wordCount: 75463,
    } }]);

    const result = await cmd.func(page, { 'novel-id': '10588915', output: '/tmp/novels', format: 'txt' });

    expect(mockMkdirSync).toHaveBeenCalledWith('/tmp/novels', { recursive: true });
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
    const [dest, content] = mockWriteFileSync.mock.calls[0];
    expect(dest).toContain('10588915');
    expect(dest).toMatch(/\.txt$/);
    expect(content).toContain('Title: 星之观测手记');
    expect(content).toContain('第一行\n第二行');
    expect(result).toEqual([{ novel_id: '10588915', title: '星之观测手记', format: 'txt', status: 'success', path: dest }]);
  });

  it('writes markdown when requested', async () => {
    const page = createPageMock([{ body: {
      id: '42', title: 'Markdown Novel', userName: 'Author', userId: '7', content: 'Body text',
      tags: { tags: [] }, createDate: '2026-01-01T00:00:00+00:00',
    } }]);

    await cmd.func(page, { 'novel-id': '42', output: '/tmp/novels', format: 'md' });
    const [dest, content] = mockWriteFileSync.mock.calls[0];
    expect(dest).toMatch(/\.md$/);
    expect(content).toContain('# Markdown Novel');
    expect(content).toContain('Body text');
  });

  it('throws CommandExecutionError instead of writing an empty file when content is missing', async () => {
    const page = createPageMock([{ body: {
      id: '42', title: 'Broken Novel', userName: 'Author', userId: '7', tags: { tags: [] },
    } }]);

    await expect(cmd.func(page, { 'novel-id': '42', output: '/tmp/novels', format: 'txt' })).rejects.toThrow(CommandExecutionError);
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it('throws ArgumentError for unsupported formats', async () => {
    const page = createPageMock([]);
    await expect(cmd.func(page, { 'novel-id': '42', format: 'epub' })).rejects.toThrow(ArgumentError);
    expect(page.goto).not.toHaveBeenCalled();
  });
});
