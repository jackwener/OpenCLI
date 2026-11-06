import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { linkHostOpencli, resolveHostOpencliRoot } from './plugin-runtime.js';

vi.mock('node:fs', async (importOriginal) => ({ ...await importOriginal<typeof fs>() }));

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-host-link-'));
  roots.push(root);
  const link = path.join(root, 'node_modules', '@jackwener', 'opencli');
  fs.mkdirSync(path.dirname(link), { recursive: true });
  return { root, link };
}
const type = process.platform === 'win32' ? 'junction' : 'dir';
const hostRealpath = () => fs.realpathSync(resolveHostOpencliRoot());
function errno(code: string, message = `${code}: operation not permitted, rename`) {
  return Object.assign(new Error(message), { code });
}
// Windows refuses to rename onto an existing junction (#2711). Model that on
// every platform; `before` lets a test interleave another process's work.
function windowsRename(before?: (from: fs.PathLike, to: fs.PathLike, call: number) => void) {
  const rename = fs.renameSync;
  let call = 0;
  return vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
    before?.(from, to, ++call);
    if (fs.lstatSync(to, { throwIfNoEntry: false })) throw errno('EPERM');
    rename(from, to);
  });
}

describe('plugin host link repair', () => {
  it('leaves a correct link untouched on repeated discovery', () => {
    const { root, link } = fixture();
    fs.symlinkSync(resolveHostOpencliRoot(), link, type);
    const before = fs.lstatSync(link);
    const rename = vi.spyOn(fs, 'renameSync');
    const remove = vi.spyOn(fs, 'rmSync');
    expect(linkHostOpencli(root)).toBe(true);
    expect(linkHostOpencli(root)).toBe(true);
    expect(fs.lstatSync(link).ino).toBe(before.ino);
    expect(rename).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it.each([false, true])('atomically repairs a stale link, dangling=%s', (dangling) => {
    const { root, link } = fixture();
    const oldHost = path.join(root, 'old-host');
    if (!dangling) fs.mkdirSync(oldHost);
    fs.symlinkSync(oldHost, link, type);
    const rename = vi.spyOn(fs, 'renameSync');
    expect(linkHostOpencli(root)).toBe(true);
    // POSIX rename replaces the link in place; Windows needs the move-aside path.
    if (process.platform !== 'win32') expect(rename).toHaveBeenCalledTimes(1);
    expect(fs.realpathSync(link)).toBe(hostRealpath());
    expect(fs.readdirSync(path.dirname(link))).toEqual(['opencli']);
  });

  it('preserves the old link and cleans up staging when publication fails', () => {
    const { root, link } = fixture();
    const oldHost = path.join(root, 'old-host');
    fs.mkdirSync(oldHost);
    fs.symlinkSync(oldHost, link, type);
    vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw new Error('publication failed'); });
    expect(linkHostOpencli(root)).toBe(false);
    expect(fs.realpathSync(link)).toBe(fs.realpathSync(oldHost));
    expect(fs.readdirSync(path.dirname(link))).toEqual(['opencli']);
  });
});

describe('plugin host link repair with Windows rename semantics (#2711)', () => {
  it('leaves a current junction untouched', () => {
    const { root, link } = fixture();
    fs.symlinkSync(resolveHostOpencliRoot(), link, type);
    const rename = windowsRename();
    expect(linkHostOpencli(root)).toBe(true);
    expect(rename).not.toHaveBeenCalled();
  });

  it.each([false, true])('replaces a stale junction, dangling=%s', (dangling) => {
    const { root, link } = fixture();
    const oldHost = path.join(root, 'old-host');
    fs.mkdirSync(oldHost);
    fs.writeFileSync(path.join(oldHost, 'package.json'), '{}');
    fs.symlinkSync(oldHost, link, type);
    if (dangling) fs.rmSync(oldHost, { recursive: true });
    windowsRename();
    expect(linkHostOpencli(root)).toBe(true);
    expect(fs.realpathSync(link)).toBe(hostRealpath());
    expect(fs.readdirSync(path.dirname(link))).toEqual(['opencli']);
    // Removing the stale link must not delete through it into the old host.
    if (!dangling) expect(fs.readdirSync(oldHost)).toEqual(['package.json']);
  });

  it('accepts a concurrent process that publishes the host link first', () => {
    const { root, link } = fixture();
    const oldHost = path.join(root, 'old-host');
    fs.mkdirSync(oldHost);
    fs.symlinkSync(oldHost, link, type);
    windowsRename((_from, to, call) => {
      if (call === 1 && to === link) {
        fs.unlinkSync(link);
        fs.symlinkSync(resolveHostOpencliRoot(), link, type);
      }
    });
    expect(linkHostOpencli(root)).toBe(true);
    expect(fs.realpathSync(link)).toBe(hostRealpath());
    expect(fs.readdirSync(path.dirname(link))).toEqual(['opencli']);
  });

  it('publishes when a concurrent repair already moved the stale link aside', () => {
    const { root, link } = fixture();
    const oldHost = path.join(root, 'old-host');
    fs.mkdirSync(oldHost);
    fs.symlinkSync(oldHost, link, type);
    windowsRename((from, _to, call) => {
      if (call === 2 && from === link) fs.unlinkSync(link);
    });
    expect(linkHostOpencli(root)).toBe(true);
    expect(fs.realpathSync(link)).toBe(hostRealpath());
    expect(fs.readdirSync(path.dirname(link))).toEqual(['opencli']);
  });

  it('fails explicitly when the stale link cannot be moved aside', () => {
    const { root, link } = fixture();
    const oldHost = path.join(root, 'old-host');
    fs.mkdirSync(oldHost);
    fs.symlinkSync(oldHost, link, type);
    vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw errno('EPERM'); });
    expect(linkHostOpencli(root)).toBe(false);
    expect(fs.realpathSync(link)).toBe(fs.realpathSync(oldHost));
    expect(fs.readdirSync(path.dirname(link))).toEqual(['opencli']);
  });

  it('restores the stale link when publication after moving it aside fails', () => {
    const { root, link } = fixture();
    const oldHost = path.join(root, 'old-host');
    fs.mkdirSync(oldHost);
    fs.symlinkSync(oldHost, link, type);
    windowsRename((from, _to, call) => {
      if (call === 3 && from !== link) throw errno('EBUSY', 'EBUSY: resource busy, rename');
    });
    expect(linkHostOpencli(root)).toBe(false);
    expect(fs.realpathSync(link)).toBe(fs.realpathSync(oldHost));
    expect(fs.readdirSync(path.dirname(link))).toEqual(['opencli']);
  });

  it('never treats a non-link target as replaceable', () => {
    const { root, link } = fixture();
    fs.writeFileSync(link, 'not a link');
    windowsRename();
    expect(linkHostOpencli(root)).toBe(false);
    expect(fs.readFileSync(link, 'utf-8')).toBe('not a link');
    expect(fs.readdirSync(path.dirname(link))).toEqual(['opencli']);
  });
});
