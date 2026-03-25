import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandExecutionError } from '../../../errors.js';
import { imagexUpload } from './imagex-upload.js';
import type { ImageXUploadInfo } from './imagex-upload.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTempImage(ext = '.jpg'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imagex-test-'));
  const filePath = path.join(dir, `cover${ext}`);
  fs.writeFileSync(filePath, Buffer.from([0xff, 0xd8, 0xff, 0xe0])); // minimal JPEG header bytes
  return filePath;
}

const FAKE_UPLOAD_INFO: ImageXUploadInfo = {
  upload_url: 'https://imagex.bytedance.com/upload/presigned/fake',
  store_uri: 'tos-cn-i-alisg.example.com/cover/abc123',
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('imagexUpload', () => {
  let imagePath: string;

  beforeEach(() => {
    imagePath = makeTempImage('.jpg');
  });

  afterEach(() => {
    // Clean up temp files
    try {
      fs.unlinkSync(imagePath);
      fs.rmdirSync(path.dirname(imagePath));
    } catch {
      // ignore cleanup errors
    }
    vi.restoreAllMocks();
  });

  it('throws CommandExecutionError when image file does not exist', async () => {
    await expect(
      imagexUpload('/nonexistent/path/cover.jpg', FAKE_UPLOAD_INFO),
    ).rejects.toThrow(CommandExecutionError);

    await expect(
      imagexUpload('/nonexistent/path/cover.jpg', FAKE_UPLOAD_INFO),
    ).rejects.toThrow('Cover image file not found');
  });

  it('PUTs the image and returns store_uri on success', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(''),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await imagexUpload(imagePath, FAKE_UPLOAD_INFO);

    expect(result).toBe(FAKE_UPLOAD_INFO.store_uri);
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(FAKE_UPLOAD_INFO.upload_url);
    expect(init.method).toBe('PUT');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe(
      'image/jpeg',
    );
  });

  it('uses image/png Content-Type for .png files', async () => {
    const pngPath = makeTempImage('.png');
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(''),
    });
    vi.stubGlobal('fetch', mockFetch);

    try {
      await imagexUpload(pngPath, FAKE_UPLOAD_INFO);
      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect((init.headers as Record<string, string>)['Content-Type']).toBe(
        'image/png',
      );
    } finally {
      try {
        fs.unlinkSync(pngPath);
        fs.rmdirSync(path.dirname(pngPath));
      } catch {
        // ignore
      }
    }
  });

  it('throws CommandExecutionError on non-2xx PUT response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: vi.fn().mockResolvedValue('Forbidden'),
    });
    vi.stubGlobal('fetch', mockFetch);

    await expect(imagexUpload(imagePath, FAKE_UPLOAD_INFO)).rejects.toThrow(
      CommandExecutionError,
    );
    await expect(imagexUpload(imagePath, FAKE_UPLOAD_INFO)).rejects.toThrow(
      'ImageX upload failed with status 403',
    );
  });
});
