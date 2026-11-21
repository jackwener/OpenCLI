import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { isDirectoryLike } from './discovery.js';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-symlink-'));
}

describe('isDirectoryLike', () => {
  it('treats real directories as directories', () => {
    const dir = makeTempDir();
    fs.mkdirSync(path.join(dir, 'site'));
    const entry = fs.readdirSync(dir, { withFileTypes: true })[0];
    expect(entry.isDirectory()).toBe(true);
    expect(isDirectoryLike(entry, dir)).toBe(true);
  });

  it('follows junctions / directory symlinks pointing at directories', () => {
    const dir = makeTempDir();
    const target = makeTempDir();
    fs.symlinkSync(target, path.join(dir, 'linked-site'), 'junction');
    const entry = fs.readdirSync(dir, { withFileTypes: true })[0];
    // readdir withFileTypes reports links as non-directories; the helper must follow the link.
    expect(entry.isDirectory()).toBe(false);
    expect(isDirectoryLike(entry, dir)).toBe(true);
  });

  it('rejects dangling links', () => {
    const dir = makeTempDir();
    fs.symlinkSync(path.join(dir, 'missing-target'), path.join(dir, 'dangling'), 'junction');
    const entry = fs.readdirSync(dir, { withFileTypes: true })[0];
    expect(isDirectoryLike(entry, dir)).toBe(false);
  });

  it('rejects symlinks pointing at files', () => {
    const dir = makeTempDir();
    const target = path.join(makeTempDir(), 'file.txt');
    fs.writeFileSync(target, 'x');
    fs.symlinkSync(target, path.join(dir, 'file-link'), 'junction');
    const entry = fs.readdirSync(dir, { withFileTypes: true })[0];
    expect(isDirectoryLike(entry, dir)).toBe(false);
  });
});
