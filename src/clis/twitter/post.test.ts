import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '../../registry.js';
import './post.js';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    statSync: vi.fn((p: string, _opts?: any) => {
      if (String(p).includes('missing')) return undefined;
      return { isFile: () => true };
    }),
  };
});

vi.mock('node:path', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:path')>();
  return {
    ...actual,
    resolve: vi.fn((p: string) => `/abs/${p}`),
    extname: vi.fn((p: string) => {
      const m = p.match(/\.[^.]+$/);
      return m ? m[0] : '';
    }),
  };
});

function makePage(overrides: Record<string, any> = {}) {
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    wait: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue({ ok: true }),
    setFileInput: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('twitter post command', () => {
  const getCommand = () => getRegistry().get('twitter/post');

  it('posts text-only tweet successfully', async () => {
    const command = getCommand();
    const page = makePage({
      evaluate: vi.fn()
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce({ ok: true, message: 'Tweet posted successfully.' }),
    });

    const result = await command!.func!(page as any, { text: 'hello world' });

    expect(result).toEqual([{ status: 'success', message: 'Tweet posted successfully.', text: 'hello world' }]);
    expect(page.goto).toHaveBeenCalledWith('https://x.com/compose/tweet');
  });

  it('returns failed when text area not found', async () => {
    const command = getCommand();
    const page = makePage({
      evaluate: vi.fn()
        .mockResolvedValueOnce({ ok: false, message: 'Could not find the tweet composer text area.' }),
    });

    const result = await command!.func!(page as any, { text: 'hello' });

    expect(result).toEqual([{ status: 'failed', message: 'Could not find the tweet composer text area.', text: 'hello' }]);
  });

  it('throws when more than 4 images', async () => {
    const command = getCommand();
    const page = makePage();

    await expect(
      command!.func!(page as any, { text: 'hi', images: 'a.png,b.png,c.png,d.png,e.png' }),
    ).rejects.toThrow('Too many images: 5 (max 4)');
  });

  it('throws when image file does not exist', async () => {
    const command = getCommand();
    const page = makePage();

    await expect(
      command!.func!(page as any, { text: 'hi', images: 'missing.png' }),
    ).rejects.toThrow('Not a valid file');
  });

  it('throws on unsupported image format', async () => {
    const command = getCommand();
    const page = makePage();

    await expect(
      command!.func!(page as any, { text: 'hi', images: 'photo.bmp' }),
    ).rejects.toThrow('Unsupported image format');
  });

  it('throws when page.setFileInput is not available', async () => {
    const command = getCommand();
    const page = makePage({
      evaluate: vi.fn().mockResolvedValueOnce({ ok: true }),
      setFileInput: undefined,
    });

    await expect(
      command!.func!(page as any, { text: 'hi', images: 'a.png' }),
    ).rejects.toThrow('Browser extension does not support file upload');
  });

  it('posts with images when upload completes', async () => {
    const command = getCommand();
    const page = makePage({
      evaluate: vi.fn()
        .mockResolvedValueOnce({ ok: true })   // type text
        .mockResolvedValueOnce(true)            // upload polling returns true
        .mockResolvedValueOnce({ ok: true, message: 'Tweet posted successfully.' }), // click post
    });

    const result = await command!.func!(page as any, { text: 'with images', images: 'a.png,b.png' });

    expect(result).toEqual([{ status: 'success', message: 'Tweet posted successfully.', text: 'with images' }]);
    expect(page.setFileInput).toHaveBeenCalled();

    const uploadScript = page.evaluate.mock.calls[1][0] as string;
    expect(uploadScript).toContain('[data-testid="attachments"]');
    expect(uploadScript).toContain('[role="group"]');
  });

  it('returns failed when image upload times out', async () => {
    const command = getCommand();
    const page = makePage({
      evaluate: vi.fn()
        .mockResolvedValueOnce({ ok: true })
        .mockResolvedValueOnce(false),
    });

    const result = await command!.func!(page as any, { text: 'timeout', images: 'a.png' });

    expect(result).toEqual([{ status: 'failed', message: 'Image upload timed out (30s).', text: 'timeout' }]);
  });

  it('validates images before navigating to compose page', async () => {
    const command = getCommand();
    const page = makePage();

    await expect(
      command!.func!(page as any, { text: 'hi', images: 'missing.png' }),
    ).rejects.toThrow('Not a valid file');

    // Should NOT have navigated since validation happens first
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('throws when no browser session', async () => {
    const command = getCommand();

    await expect(
      command!.func!(null as any, { text: 'hi' }),
    ).rejects.toThrow('Browser session required for twitter post');
  });
});
