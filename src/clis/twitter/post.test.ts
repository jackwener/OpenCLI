import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '../../registry.js';
import './post.js';

vi.mock('node:fs', () => ({
  statSync: vi.fn((p: string, _opts?: any) => {
    if (p.includes('missing')) return null;
    return { isFile: () => true };
  }),
}));

vi.mock('node:path', () => ({
  resolve: vi.fn((p: string) => `/abs/${p}`),
}));

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
        .mockResolvedValueOnce({ ok: true })                              // type text
        .mockResolvedValueOnce({ ok: true, message: 'Tweet posted successfully.' }), // click post
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
    const page = makePage({
      evaluate: vi.fn().mockResolvedValueOnce({ ok: true }), // type text
    });

    await expect(
      command!.func!(page as any, { text: 'hi', images: 'a.png,b.png,c.png,d.png,e.png' }),
    ).rejects.toThrow('Too many images: 5 (max 4)');
  });

  it('throws when image file does not exist', async () => {
    const command = getCommand();
    const page = makePage({
      evaluate: vi.fn().mockResolvedValueOnce({ ok: true }),
    });

    await expect(
      command!.func!(page as any, { text: 'hi', images: 'missing.png' }),
    ).rejects.toThrow('Not a valid file');
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

    // Verify the upload polling script checks attachments and group count
    const uploadScript = page.evaluate.mock.calls[1][0] as string;
    expect(uploadScript).toContain('[data-testid="attachments"]');
    expect(uploadScript).toContain('[role="group"]');
    expect(uploadScript).toContain('!== 2');  // 2 images
  });

  it('returns failed when image upload times out', async () => {
    const command = getCommand();
    const page = makePage({
      evaluate: vi.fn()
        .mockResolvedValueOnce({ ok: true })  // type text
        .mockResolvedValueOnce(false),         // upload polling returns false (timeout)
    });

    const result = await command!.func!(page as any, { text: 'timeout', images: 'a.png' });

    expect(result).toEqual([{ status: 'failed', message: 'Image upload timed out (30s).', text: 'timeout' }]);
  });

  it('throws when no browser session', async () => {
    const command = getCommand();

    await expect(
      command!.func!(null, { text: 'hi' }),
    ).rejects.toThrow('Browser session required for twitter post');
  });
});
