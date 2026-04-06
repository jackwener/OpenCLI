import * as fs from 'node:fs';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BrowserCookie, IPage } from '@jackwener/opencli/types';
import {
  buildInstallInstagramProtocolCaptureJs,
  buildReadInstagramProtocolCaptureJs,
  dumpInstagramProtocolCaptureIfEnabled,
  instagramPrivateApiFetch,
  installInstagramProtocolCapture,
  readInstagramProtocolCapture,
} from './protocol-capture.js';

describe('instagram protocol capture helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.OPENCLI_INSTAGRAM_CAPTURE;
    try { fs.rmSync('/tmp/instagram_post_protocol_trace.json', { force: true }); } catch {}
  });

  it('installs the protocol capture patch in page context', async () => {
    const evaluate = vi.fn().mockResolvedValue({ ok: true });
    const page = { evaluate } as unknown as IPage;

    await installInstagramProtocolCapture(page);

    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(String(evaluate.mock.calls[0]?.[0] || '')).toContain('__opencli_ig_protocol_capture');
    expect(String(evaluate.mock.calls[0]?.[0] || '')).toContain('/media/configure_sidecar/');
  });

  it('prefers native page network capture when available', async () => {
    const startNetworkCapture = vi.fn().mockResolvedValue(undefined);
    const evaluate = vi.fn();
    const hasNativeCaptureSupport = vi.fn().mockReturnValue(true);
    const page = { startNetworkCapture, evaluate, hasNativeCaptureSupport } as unknown as IPage;

    await installInstagramProtocolCapture(page);

    expect(startNetworkCapture).toHaveBeenCalledTimes(1);
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('falls back to the page patch when native capture is unavailable after start', async () => {
    const startNetworkCapture = vi.fn().mockResolvedValue(undefined);
    const hasNativeCaptureSupport = vi.fn().mockReturnValue(false);
    const evaluate = vi.fn().mockResolvedValue({ ok: true });
    const page = { startNetworkCapture, evaluate, hasNativeCaptureSupport } as unknown as IPage;

    await installInstagramProtocolCapture(page);

    expect(startNetworkCapture).toHaveBeenCalledTimes(1);
    expect(evaluate).toHaveBeenCalledTimes(1);
  });

  it('reads and normalizes captured protocol entries', async () => {
    const evaluate = vi.fn().mockResolvedValue({
      data: [{ kind: 'fetch', url: 'https://www.instagram.com/api/v1/media/configure/' }],
      errors: ['ignored'],
    });
    const page = { evaluate } as unknown as IPage;

    const result = await readInstagramProtocolCapture(page);

    expect(String(evaluate.mock.calls[0]?.[0] || '')).toContain('__opencli_ig_protocol_capture');
    expect(result).toEqual({
      data: [{ kind: 'fetch', url: 'https://www.instagram.com/api/v1/media/configure/' }],
      errors: ['ignored'],
    });
  });

  it('prefers native page network capture reads when available', async () => {
    const readNetworkCapture = vi.fn().mockResolvedValue([
      { kind: 'cdp', url: 'https://www.instagram.com/rupload_igphoto/test', method: 'POST' },
    ]);
    const evaluate = vi.fn();
    const hasNativeCaptureSupport = vi.fn().mockReturnValue(true);
    const page = { readNetworkCapture, evaluate, hasNativeCaptureSupport } as unknown as IPage;

    const result = await readInstagramProtocolCapture(page);

    expect(readNetworkCapture).toHaveBeenCalledTimes(1);
    expect(evaluate).not.toHaveBeenCalled();
    expect(result).toEqual({
      data: [{ kind: 'cdp', url: 'https://www.instagram.com/rupload_igphoto/test', method: 'POST' }],
      errors: [],
    });
  });

  it('falls back to the page patch read when native capture is unavailable after read', async () => {
    const readNetworkCapture = vi.fn().mockResolvedValue([
      { url: 'https://www.instagram.com/api/v1/web/resource/', method: 'GET' },
    ]);
    const hasNativeCaptureSupport = vi.fn().mockReturnValue(false);
    const evaluate = vi.fn().mockResolvedValue({
      data: [{ kind: 'fetch', url: 'https://www.instagram.com/api/v1/media/configure/', method: 'POST' }],
      errors: ['fallback-used'],
    });
    const page = { readNetworkCapture, evaluate, hasNativeCaptureSupport } as unknown as IPage;

    const result = await readInstagramProtocolCapture(page);

    expect(readNetworkCapture).toHaveBeenCalledTimes(1);
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      data: [{ kind: 'fetch', url: 'https://www.instagram.com/api/v1/media/configure/', method: 'POST' }],
      errors: ['fallback-used'],
    });
  });

  it('dumps protocol traces to /tmp only when capture env is enabled', async () => {
    process.env.OPENCLI_INSTAGRAM_CAPTURE = '1';
    const page = {
      evaluate: vi.fn().mockResolvedValue({
        data: [{ kind: 'fetch', url: 'https://www.instagram.com/rupload_igphoto/test' }],
        errors: [],
      }),
    } as unknown as IPage;

    await dumpInstagramProtocolCaptureIfEnabled(page);

    const raw = fs.readFileSync('/tmp/instagram_post_protocol_trace.json', 'utf8');
    expect(raw).toContain('rupload_igphoto');
  });

  it('does not dump protocol traces when capture env is disabled', async () => {
    const page = {
      evaluate: vi.fn(),
    } as unknown as IPage;

    await dumpInstagramProtocolCaptureIfEnabled(page);

    expect(page.evaluate).not.toHaveBeenCalled();
    expect(fs.existsSync('/tmp/instagram_post_protocol_trace.json')).toBe(false);
  });
});

describe('instagram private api fetch', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses browser cookies to build instagram private api requests', async () => {
    const getCookies = vi.fn()
      .mockResolvedValueOnce([{ name: 'sessionid', value: 'sess', domain: '.instagram.com' } satisfies BrowserCookie])
      .mockResolvedValueOnce([
        { name: 'csrftoken', value: 'csrf', domain: '.instagram.com' } satisfies BrowserCookie,
        { name: 'sessionid', value: 'sess', domain: '.instagram.com' } satisfies BrowserCookie,
      ]);
    const evaluate = vi.fn().mockResolvedValue({
      appId: 'dynamic-app-id',
      csrfToken: 'csrf',
      instagramAjax: 'dynamic-rollout',
    });
    const page = { getCookies, evaluate } as unknown as IPage;
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await instagramPrivateApiFetch(page, 'https://www.instagram.com/api/v1/media/configure/', {
      method: 'POST',
      body: 'caption=test',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://www.instagram.com/api/v1/media/configure/',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-CSRFToken': 'csrf',
          'X-IG-App-ID': 'dynamic-app-id',
          'Cookie': expect.stringContaining('sessionid=sess'),
        }),
        body: 'caption=test',
      }),
    );
  });

  it('exposes stable browser-side JS builders', () => {
    expect(buildInstallInstagramProtocolCaptureJs()).toContain('/rupload_igphoto/');
    expect(buildReadInstagramProtocolCaptureJs()).toContain('__opencli_ig_protocol_capture');
  });
});
