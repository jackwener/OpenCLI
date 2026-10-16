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
    const rename = fs.renameSync;
    const publication = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
      expect(fs.readlinkSync(link)).toContain('old-host');
      rename(from, to);
    });
    expect(linkHostOpencli(root)).toBe(true);
    expect(publication).toHaveBeenCalledTimes(1);
    expect(fs.realpathSync(link)).toBe(fs.realpathSync(resolveHostOpencliRoot()));
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
