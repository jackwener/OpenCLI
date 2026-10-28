import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { spawn, execFileSync } = vi.hoisted(() => ({ spawn: vi.fn(), execFileSync: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn, execFileSync }));

import { ytdlpDownload } from './index.js';

const directories: string[] = [];

beforeEach(() => {
  spawn.mockReset();
  execFileSync.mockReset();
});

afterEach(() => {
  for (const directory of directories) fs.rmSync(directory, { recursive: true, force: true });
  directories.length = 0;
});

function setup(filename: string) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-ytdlp-'));
  directories.push(directory);
  const existing = path.join(directory, filename);
  fs.writeFileSync(existing, 'existing bytes');
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() });
  spawn.mockReturnValue(child);
  return { child, existing, destination: path.join(directory, 'clip.mp4') };
}

describe('ytdlpDownload exit status', () => {
  it.each(['clip.mp4', 'clip.mp4.part', 'clip-old.webm'])(
    'reports failure after a nonzero exit despite an existing %s', async (filename) => {
      const { child, existing, destination } = setup(filename);
      const pending = ytdlpDownload('https://example.test/video', destination);
      child.stderr.write('ERROR: HTTP Error 503: Service Unavailable');
      child.emit('close', 1);
      await expect(pending).resolves.toEqual({
        success: false, size: 0, error: 'ERROR: HTTP Error 503: Service Unavailable',
      });
      expect(fs.readFileSync(existing, 'utf8')).toBe('existing bytes');
    },
  );

  it('reports signal termination without treating an existing destination as success', async () => {
    const { child, destination } = setup('clip.mp4');
    const pending = ytdlpDownload('https://example.test/video', destination);
    child.emit('close', null, 'SIGTERM');
    await expect(pending).resolves.toMatchObject({ success: false, size: 0 });
  });

  it.each(['clip.mp4', 'clip.webm'])('retains zero-exit handling for %s', async (filename) => {
    const { child, destination } = setup(filename);
    const pending = ytdlpDownload('https://example.test/video', destination);
    child.emit('close', 0);
    await expect(pending).resolves.toEqual({ success: true, size: Buffer.byteLength('existing bytes') });
  });
});
