import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { createPageMock } from '../test-utils.js';
import './novel-download.js';

let cmd;
let tempRoot;

beforeAll(() => {
  cmd = getRegistry().get('pixiv/novel-download');
  expect(cmd?.func).toBeTypeOf('function');
});

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-pixiv-novel-'));
});

afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

function novelBody(overrides = {}) {
  return {
    id: '10588915', title: '星之观测手记', userName: '示例作者', userId: '37119297',
    content: '第一行\n第二行', tags: { tags: [{ tag: '一般' }, { tag: '中文' }] },
    createDate: '2019-01-06T12:48:16+00:00', bookmarkCount: 2829, wordCount: 75463,
    ...overrides,
  };
}

describe('pixiv novel-download', () => {
  it('requires --execute before validation, navigation, or writes', async () => {
    const page = createPageMock([]);
    await expect(cmd.func(page, { 'novel-id': '10588915', output: tempRoot })).rejects.toThrow(/--execute/);
    expect(page.goto).not.toHaveBeenCalled();
    expect(fs.readdirSync(tempRoot)).toEqual([]);
  });

  it('throws ArgumentError on invalid novel ID before navigation', async () => {
    const page = createPageMock([]);
    await expect(cmd.func(page, { 'novel-id': 'abc', output: tempRoot, execute: true })).rejects.toThrow(ArgumentError);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('rejects symbolic-link output roots before navigation', async () => {
    const actual = path.join(tempRoot, 'actual');
    const linked = path.join(tempRoot, 'linked');
    fs.mkdirSync(actual);
    fs.symlinkSync(actual, linked, 'dir');
    const page = createPageMock([]);
    await expect(cmd.func(page, { 'novel-id': '10588915', output: linked, execute: true })).rejects.toThrow(ArgumentError);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('throws AuthRequiredError on 403 without creating a file', async () => {
    const page = createPageMock([{ __httpError: 403 }]);
    await expect(cmd.func(page, { 'novel-id': '10588915', output: tempRoot, execute: true })).rejects.toThrow(AuthRequiredError);
    expect(fs.readdirSync(tempRoot)).toEqual([]);
  });

  it('writes a txt file with metadata and full novel content', async () => {
    const page = createPageMock([{ body: novelBody() }]);
    const result = await cmd.func(page, { 'novel-id': '10588915', output: tempRoot, 'file-format': 'txt', execute: true });
    const destination = result[0].path;
    expect(destination).toContain('10588915');
    expect(destination).toMatch(/\.txt$/);
    const content = fs.readFileSync(destination, 'utf8');
    expect(content).toContain('Title: 星之观测手记');
    expect(content).toContain('第一行\n第二行');
    expect(result).toEqual([{ novel_id: '10588915', title: '星之观测手记', format: 'txt', status: 'success', path: destination }]);
  });

  it('writes markdown when requested', async () => {
    const page = createPageMock([{ body: novelBody({ id: '42', title: 'Markdown Novel', userId: '7', content: 'Body text', tags: { tags: [] } }) }]);
    const result = await cmd.func(page, { 'novel-id': '42', output: tempRoot, 'file-format': 'md', execute: true });
    const content = fs.readFileSync(result[0].path, 'utf8');
    expect(result[0].path).toMatch(/\.md$/);
    expect(content).toContain('# Markdown Novel');
    expect(content).toContain('Body text');
  });

  it('fails typed before writing when content is missing', async () => {
    const page = createPageMock([{ body: novelBody({ content: undefined }) }]);
    await expect(cmd.func(page, { 'novel-id': '10588915', output: tempRoot, execute: true })).rejects.toThrow(CommandExecutionError);
    expect(fs.readdirSync(tempRoot)).toEqual([]);
  });

  it('rejects an existing target without modifying it', async () => {
    const existing = path.join(tempRoot, '10588915.txt');
    fs.writeFileSync(existing, 'keep me');
    const page = createPageMock([{ body: novelBody() }]);
    await expect(cmd.func(page, { 'novel-id': '10588915', output: tempRoot, execute: true })).rejects.toThrow(/overwrite/);
    expect(fs.readFileSync(existing, 'utf8')).toBe('keep me');
  });

  it('throws ArgumentError for unsupported formats before navigation', async () => {
    const page = createPageMock([]);
    await expect(cmd.func(page, { 'novel-id': '42', output: tempRoot, 'file-format': 'epub', execute: true })).rejects.toThrow(ArgumentError);
    expect(page.goto).not.toHaveBeenCalled();
  });
});
