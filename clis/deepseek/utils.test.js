import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendWithFile } from './utils.js';

describe('deepseek sendWithFile', () => {
  const tempDirs = [];

  afterEach(() => {
    vi.restoreAllMocks();
    while (tempDirs.length) {
      fs.rmSync(tempDirs.pop(), { recursive: true, force: true });
    }
  });

  it('prefers page.setFileInput over base64-in-evaluate when supported', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-deepseek-'));
    tempDirs.push(dir);
    const filePath = path.join(dir, 'report.txt');
    fs.writeFileSync(filePath, 'hello');

    const page = {
      setFileInput: vi.fn().mockResolvedValue(undefined),
      wait: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce({ ok: true }),
    };

    const result = await sendWithFile(page, filePath, 'summarize this');

    expect(result).toEqual({ ok: true });
    expect(page.setFileInput).toHaveBeenCalledWith([filePath], 'input[type="file"]');
  });
});
