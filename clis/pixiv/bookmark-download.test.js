import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { createPageMock } from '../test-utils.js';

const { mockHttpDownload } = vi.hoisted(() => ({ mockHttpDownload: vi.fn() }));

vi.mock('@jackwener/opencli/download', async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, httpDownload: mockHttpDownload };
});

await import('./bookmark-download.js');

let cmd;
let tempRoot;

beforeAll(() => {
  cmd = getRegistry().get('pixiv/bookmark-download');
  expect(cmd?.func).toBeTypeOf('function');
});

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-pixiv-bookmarks-'));
  mockHttpDownload.mockReset();
  mockHttpDownload.mockImplementation(async (url, destination) => {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, 'image-bytes');
    return { success: true, size: 11, contentType: 'image/png', finalUrl: url };
  });
});

afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

const currentUser = { found: true, user: { id: '37119297', name: 'owner' } };
const loggedInPage = (results) => createPageMock(results, {
  getCookies: vi.fn().mockResolvedValue([{ name: 'PHPSESSID', value: '37119297_session' }]),
});
const illust = (id, title = `illust-${id}`) => ({ id, title, userName: '作者A', userId: '100', pageCount: 1, tags: [] });
const imagePage = (id) => ({ body: [{ urls: { original: `https://i.pximg.net/img-original/img/${id}_p0.png` } }] });

describe('pixiv bookmark-download', () => {
  it('requires --execute before validation, navigation, or writes', async () => {
    const page = createPageMock([]);
    await expect(cmd.func(page, { type: 'illust', output: tempRoot })).rejects.toThrow(/--execute/);
    expect(page.goto).not.toHaveBeenCalled();
    expect(fs.readdirSync(tempRoot)).toEqual([]);
  });

  it('throws ArgumentError on invalid type before navigation', async () => {
    const page = createPageMock([]);
    await expect(cmd.func(page, { type: 'music', output: tempRoot, execute: true })).rejects.toThrow(ArgumentError);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('distinguishes a true empty bookmark page from malformed data', async () => {
    const page = loggedInPage([currentUser, { body: { works: [] } }]);
    await expect(cmd.func(page, { type: 'illust', output: tempRoot, execute: true })).rejects.toMatchObject({
      name: EmptyResultError.name,
      hint: expect.stringMatching(/No Pixiv bookmarks/),
    });
    expect(mockHttpDownload).not.toHaveBeenCalled();
    expect(fs.readdirSync(tempRoot)).toEqual([]);
  });

  it('downloads one illustration bookmark through a staging directory', async () => {
    const page = loggedInPage([
      currentUser,
      { body: { works: [illust('12345', '星空')] } },
      imagePage('12345'),
    ]);

    const result = await cmd.func(page, { type: 'illust', limit: 1, output: tempRoot, execute: true });
    const finalPath = path.join(fs.realpathSync.native(tempRoot), 'illust', '12345');
    expect(mockHttpDownload).toHaveBeenCalledTimes(1);
    expect(mockHttpDownload.mock.calls[0][2]).toMatchObject({
      headers: { Referer: 'https://www.pixiv.net/' },
      includeContentType: true,
    });
    expect(fs.readFileSync(path.join(finalPath, '12345_p0.png'), 'utf8')).toBe('image-bytes');
    expect(result).toEqual([{ rank: 1, type: 'illust', id: '12345', title: '星空', download_status: 'success', path: finalPath }]);
  });

  it('downloads one novel bookmark only after full detail validation', async () => {
    const page = loggedInPage([
      currentUser,
      { body: { works: [{ id: '10588915', title: '星之观测手记', userName: '作者B', userId: '200', tags: [] }] } },
      { body: { id: '10588915', title: '星之观测手记', userName: '作者B', userId: '200', content: '正文', tags: { tags: [] } } },
    ]);

    const result = await cmd.func(page, { type: 'novel', limit: 1, output: tempRoot, 'file-format': 'txt', execute: true });
    expect(fs.readFileSync(result[0].path, 'utf8')).toContain('正文');
    expect(result[0]).toMatchObject({ rank: 1, type: 'novel', id: '10588915', download_status: 'success' });
  });

  it('rejects malformed novel metadata before creating the batch output tree', async () => {
    const page = loggedInPage([
      currentUser,
      { body: { works: [{ id: '10588915', title: '星之观测手记', userName: '作者B', userId: '200', tags: [] }] } },
      { body: {
        id: '10588915', title: '星之观测手记', userName: '作者B', userId: '200',
        content: '正文', tags: { tags: [] }, wordCount: { drifted: true },
      } },
    ]);
    await expect(cmd.func(page, { type: 'novel', output: tempRoot, execute: true })).rejects.toThrow(CommandExecutionError);
    expect(fs.readdirSync(tempRoot)).toEqual([]);
  });

  it('completes every page/schema plan before creating any file', async () => {
    const page = loggedInPage([
      currentUser,
      { body: { works: [illust('1'), illust('2')] } },
      imagePage('1'),
      { body: [{ urls: { original: 'https://evil.example/2.png' } }] },
    ]);
    await expect(cmd.func(page, { type: 'illust', limit: 2, output: tempRoot, execute: true })).rejects.toThrow(CommandExecutionError);
    expect(mockHttpDownload).not.toHaveBeenCalled();
    expect(fs.readdirSync(tempRoot)).toEqual([]);
  });

  it('rejects duplicate batch targets before downloading', async () => {
    const page = loggedInPage([
      currentUser,
      { body: { works: [illust('1'), illust('1')] } },
      imagePage('1'),
      imagePage('1'),
    ]);
    await expect(cmd.func(page, { type: 'illust', limit: 2, output: tempRoot, execute: true })).rejects.toThrow(/duplicate download target/);
    expect(mockHttpDownload).not.toHaveBeenCalled();
    expect(fs.readdirSync(tempRoot)).toEqual([]);
  });

  it('rolls back the first completed item when the second download fails', async () => {
    const existing = path.join(tempRoot, 'keep.txt');
    fs.writeFileSync(existing, 'user data');
    mockHttpDownload
      .mockImplementationOnce(async (url, destination) => {
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.writeFileSync(destination, 'first');
        return { success: true, size: 5, contentType: 'image/png', finalUrl: url };
      })
      .mockImplementationOnce(async (_url, destination) => {
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.writeFileSync(destination, 'partial');
        return { success: false, size: 0, error: 'network down' };
      });
    const page = loggedInPage([
      currentUser,
      { body: { works: [illust('1'), illust('2')] } },
      imagePage('1'),
      imagePage('2'),
    ]);

    await expect(cmd.func(page, { type: 'illust', limit: 2, output: tempRoot, execute: true })).rejects.toThrow(/network down/);
    expect(fs.existsSync(path.join(tempRoot, 'illust', '1'))).toBe(false);
    expect(fs.existsSync(path.join(tempRoot, 'illust', '2'))).toBe(false);
    expect(fs.readFileSync(existing, 'utf8')).toBe('user data');
  });

  it('rejects off-host redirects or wrong content types and removes staging', async () => {
    mockHttpDownload.mockImplementationOnce(async (_url, destination) => {
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, '<html>login</html>');
      return { success: true, size: 18, contentType: 'text/html', finalUrl: 'https://www.pixiv.net/login' };
    });
    const page = loggedInPage([currentUser, { body: { works: [illust('123')] } }, imagePage('123')]);
    await expect(cmd.func(page, { type: 'illust', output: tempRoot, execute: true })).rejects.toThrow(CommandExecutionError);
    expect(fs.existsSync(path.join(tempRoot, 'illust', '123'))).toBe(false);
    const illustRoot = path.join(tempRoot, 'illust');
    expect(fs.existsSync(illustRoot) ? fs.readdirSync(illustRoot) : []).toEqual([]);
  });

  it('rejects existing targets without touching user files or downloading', async () => {
    const finalPath = path.join(tempRoot, 'illust', '12345');
    fs.mkdirSync(finalPath, { recursive: true });
    fs.writeFileSync(path.join(finalPath, 'keep.txt'), 'keep me');
    const page = loggedInPage([currentUser, { body: { works: [illust('12345')] } }, imagePage('12345')]);
    await expect(cmd.func(page, { type: 'illust', output: tempRoot, execute: true })).rejects.toThrow(/overwrite/);
    expect(mockHttpDownload).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(finalPath, 'keep.txt'), 'utf8')).toBe('keep me');
  });

  it('fails before writing paths when bookmark IDs are malformed', async () => {
    const page = loggedInPage([
      currentUser,
      { body: { works: [{ id: '../escape', title: '星空', userName: '作者A', userId: '100', tags: [] }] } },
    ]);
    await expect(cmd.func(page, { type: 'illust', output: tempRoot, execute: true })).rejects.toThrow(CommandExecutionError);
    expect(mockHttpDownload).not.toHaveBeenCalled();
    expect(fs.readdirSync(tempRoot)).toEqual([]);
  });
});
