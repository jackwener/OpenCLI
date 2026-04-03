import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import type { InstagramProtocolCaptureEntry } from './protocol-capture.js';
import {
  buildConfigureBody,
  buildConfigureSidecarPayload,
  deriveInstagramJazoest,
  derivePrivateApiContextFromCapture,
  extractInstagramRuntimeInfo,
  getInstagramFeedNormalizedDimensions,
  isInstagramFeedAspectRatioAllowed,
  publishMediaViaPrivateApi,
  publishImagesViaPrivateApi,
  readImageAsset,
  resolveInstagramPrivatePublishConfig,
} from './private-publish.js';

const tempDirs: string[] = [];

function createTempFile(name: string, bytes: Buffer): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-instagram-private-'));
  tempDirs.push(dir);
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, bytes);
  return filePath;
}

afterAll(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('instagram private publish helpers', () => {
  it('derives the private API context from captured instagram request headers', () => {
    const entries: InstagramProtocolCaptureEntry[] = [
      {
        kind: 'cdp' as never,
        url: 'https://www.instagram.com/api/v1/feed/timeline/',
        method: 'GET',
        requestHeaders: {
          'X-ASBD-ID': '359341',
          'X-CSRFToken': 'csrf-token',
          'X-IG-App-ID': '936619743392459',
          'X-IG-WWW-Claim': 'hmac.claim',
          'X-Instagram-AJAX': '1036517563',
          'X-Web-Session-ID': 'abc:def:ghi',
        },
        timestamp: Date.now(),
      },
    ];

    expect(derivePrivateApiContextFromCapture(entries)).toEqual({
      asbdId: '359341',
      csrfToken: 'csrf-token',
      igAppId: '936619743392459',
      igWwwClaim: 'hmac.claim',
      instagramAjax: '1036517563',
      webSessionId: 'abc:def:ghi',
    });
  });

  it('derives jazoest from the csrf token', () => {
    expect(deriveInstagramJazoest('SJ_btbvfkpAVFKCN_tJstW')).toBe('22047');
  });

  it('extracts app id, rollout hash, and csrf token from instagram html', () => {
    const html = `
      <html>
        <head>
          <script type="application/json">
            {"csrf_token":"csrf-from-html","rollout_hash":"1036523242","X-IG-App-ID":"936619743392459"}
          </script>
        </head>
      </html>
    `;
    expect(extractInstagramRuntimeInfo(html)).toEqual({
      appId: '936619743392459',
      csrfToken: 'csrf-from-html',
      instagramAjax: '1036523242',
    });
  });

  it('resolves private publish config from capture, runtime html, and cookies', async () => {
    const entries: InstagramProtocolCaptureEntry[] = [
      {
        kind: 'cdp' as never,
        url: 'https://www.instagram.com/api/v1/feed/timeline/',
        method: 'GET',
        requestHeaders: {
          'X-ASBD-ID': '359341',
          'X-IG-WWW-Claim': 'hmac.claim',
          'X-Web-Session-ID': 'abc:def:ghi',
        },
        timestamp: Date.now(),
      },
    ];
    const page = {
      goto: async () => undefined,
      wait: async () => undefined,
      getCookies: async () => [{ name: 'csrftoken', value: 'csrf-cookie', domain: 'instagram.com' }],
      startNetworkCapture: async () => undefined,
      readNetworkCapture: async () => entries,
      evaluate: async () => ({
        appId: '936619743392459',
        csrfToken: 'csrf-from-html',
        instagramAjax: '1036523242',
      }),
    } as any;

    await expect(resolveInstagramPrivatePublishConfig(page)).resolves.toEqual({
      apiContext: {
        asbdId: '359341',
        csrfToken: 'csrf-from-html',
        igAppId: '936619743392459',
        igWwwClaim: 'hmac.claim',
        instagramAjax: '1036523242',
        webSessionId: 'abc:def:ghi',
      },
      jazoest: deriveInstagramJazoest('csrf-from-html'),
    });
  });

  it('retries transient private publish config resolution failures and then succeeds', async () => {
    const entries: InstagramProtocolCaptureEntry[] = [
      {
        kind: 'cdp' as never,
        url: 'https://www.instagram.com/api/v1/feed/timeline/',
        method: 'GET',
        requestHeaders: {
          'X-ASBD-ID': '359341',
          'X-IG-WWW-Claim': 'hmac.claim',
          'X-Web-Session-ID': 'abc:def:ghi',
        },
        timestamp: Date.now(),
      },
    ];
    let evaluateAttempts = 0;
    const page = {
      goto: async () => undefined,
      wait: async () => undefined,
      getCookies: async () => [{ name: 'csrftoken', value: 'csrf-cookie', domain: 'instagram.com' }],
      startNetworkCapture: async () => undefined,
      readNetworkCapture: async () => entries,
      evaluate: async () => {
        evaluateAttempts += 1;
        if (evaluateAttempts === 1) {
          throw new TypeError('fetch failed');
        }
        return {
          appId: '936619743392459',
          csrfToken: 'csrf-from-html',
          instagramAjax: '1036523242',
        };
      },
    } as any;

    await expect(resolveInstagramPrivatePublishConfig(page)).resolves.toEqual({
      apiContext: {
        asbdId: '359341',
        csrfToken: 'csrf-from-html',
        igAppId: '936619743392459',
        igWwwClaim: 'hmac.claim',
        instagramAjax: '1036523242',
        webSessionId: 'abc:def:ghi',
      },
      jazoest: deriveInstagramJazoest('csrf-from-html'),
    });
    expect(evaluateAttempts).toBe(2);
  });

  it('builds the single-image configure form body', () => {
    expect(buildConfigureBody({
      uploadId: '1775134280303',
      caption: 'hello private route',
      jazoest: '22047',
    })).toBe(
      'archive_only=false&caption=hello+private+route&clips_share_preview_to_feed=1'
      + '&disable_comments=0&disable_oa_reuse=false&igtv_share_preview_to_feed=1'
      + '&is_meta_only_post=0&is_unified_video=1&like_and_view_counts_disabled=0'
      + '&media_share_flow=creation_flow&share_to_facebook=&share_to_fb_destination_type=USER'
      + '&source_type=library&upload_id=1775134280303&video_subtitles_enabled=0&jazoest=22047'
    );
  });

  it('builds the carousel configure_sidecar JSON payload', () => {
    expect(buildConfigureSidecarPayload({
      uploadIds: ['1', '3', '2'],
      caption: 'hello carousel',
      clientSidecarId: '1775134574348',
      jazoest: '22047',
    })).toEqual({
      archive_only: false,
      caption: 'hello carousel',
      children_metadata: [
        { upload_id: '1' },
        { upload_id: '3' },
        { upload_id: '2' },
      ],
      client_sidecar_id: '1775134574348',
      disable_comments: '0',
      is_meta_only_post: false,
      is_open_to_public_submission: false,
      like_and_view_counts_disabled: 0,
      media_share_flow: 'creation_flow',
      share_to_facebook: '',
      share_to_fb_destination_type: 'USER',
      source_type: 'library',
      jazoest: '22047',
    });
  });

  it('reads png and jpeg image assets with mime type and dimensions', () => {
    const png = createTempFile('sample.png', Buffer.from(
      '89504E470D0A1A0A0000000D49484452000000030000000508060000008D6F26E50000000049454E44AE426082',
      'hex',
    ));
    const jpeg = createTempFile('sample.jpg', Buffer.from(
      'FFD8FFE000104A46494600010100000100010000FFC00011080004000603012200021101031101FFD9',
      'hex',
    ));

    expect(readImageAsset(png)).toMatchObject({
      mimeType: 'image/png',
      width: 3,
      height: 5,
    });
    expect(readImageAsset(jpeg)).toMatchObject({
      mimeType: 'image/jpeg',
      width: 6,
      height: 4,
    });
  });

  it('computes feed-safe aspect-ratio normalization targets', () => {
    expect(isInstagramFeedAspectRatioAllowed(1080, 1350)).toBe(true);
    expect(isInstagramFeedAspectRatioAllowed(1179, 2556)).toBe(false);
    expect(getInstagramFeedNormalizedDimensions(1179, 2556)).toEqual({
      width: 2045,
      height: 2556,
    });
    expect(getInstagramFeedNormalizedDimensions(2120, 1140)).toBeNull();
  });

  it('publishes a single image through rupload + configure', async () => {
    const jpeg = createTempFile('private-single.jpg', Buffer.from(
      'FFD8FFE000104A46494600010100000100010000FFC00011080004000603012200021101031101FFD9',
      'hex',
    ));
    const calls: Array<{ url: string; init?: { method?: string; headers?: Record<string, string>; body?: unknown } }> = [];
    const fetcher = async (url: string | URL, init?: { method?: string; headers?: Record<string, string>; body?: unknown }) => {
      calls.push({ url: String(url), init });
      if (String(url).includes('/rupload_igphoto/')) {
        return new Response('{"upload_id":"111","status":"ok"}', { status: 200 });
      }
      return new Response('{"media":{"code":"ABC123"}}', { status: 200 });
    };

    const response = await publishImagesViaPrivateApi({
      page: {} as never,
      imagePaths: [jpeg],
      caption: 'private single',
      apiContext: {
        asbdId: '359341',
        csrfToken: 'csrf-token',
        igAppId: '936619743392459',
        igWwwClaim: 'hmac.claim',
        instagramAjax: '1036517563',
        webSessionId: 'abc:def:ghi',
      },
      jazoest: '22047',
      now: () => 111,
      fetcher,
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toContain('https://i.instagram.com/rupload_igphoto/fb_uploader_111');
    expect(calls[0]?.init?.headers).toMatchObject({
      'Content-Type': 'image/jpeg',
      'X-Entity-Length': String(fs.statSync(jpeg).size),
      'X-Entity-Name': 'fb_uploader_111',
      'X-IG-App-ID': '936619743392459',
    });
    expect(calls[1]?.url).toBe('https://www.instagram.com/api/v1/media/configure/');
    expect(String(calls[1]?.init?.body || '')).toContain('upload_id=111');
    expect(response).toEqual({ code: 'ABC123', uploadIds: ['111'] });
  });

  it('publishes a carousel through rupload + configure_sidecar', async () => {
    const first = createTempFile('private-carousel-1.jpg', Buffer.from(
      'FFD8FFE000104A46494600010100000100010000FFC00011080004000603012200021101031101FFD9',
      'hex',
    ));
    const second = createTempFile('private-carousel-2.png', Buffer.from(
      '89504E470D0A1A0A0000000D49484452000000030000000508060000008D6F26E50000000049454E44AE426082',
      'hex',
    ));
    const calls: Array<{ url: string; init?: { method?: string; headers?: Record<string, string>; body?: unknown } }> = [];
    let uploadCounter = 0;
    const fetcher = async (url: string | URL, init?: { method?: string; headers?: Record<string, string>; body?: unknown }) => {
      calls.push({ url: String(url), init });
      if (String(url).includes('/rupload_igphoto/')) {
        uploadCounter += 1;
        return new Response(JSON.stringify({ upload_id: String(200 + uploadCounter), status: 'ok' }), { status: 200 });
      }
      return new Response('{"media":{"code":"SIDE123"}}', { status: 200 });
    };

    const response = await publishImagesViaPrivateApi({
      page: {} as never,
      imagePaths: [first, second],
      caption: 'private carousel',
      apiContext: {
        asbdId: '359341',
        csrfToken: 'csrf-token',
        igAppId: '936619743392459',
        igWwwClaim: 'hmac.claim',
        instagramAjax: '1036517563',
        webSessionId: 'abc:def:ghi',
      },
      jazoest: '22047',
      now: () => 200,
      fetcher,
      prepareAsset: async (filePath) => readImageAsset(filePath),
    });

    expect(calls).toHaveLength(3);
    expect(calls[2]?.url).toBe('https://www.instagram.com/api/v1/media/configure_sidecar/');
    expect(JSON.parse(String(calls[2]?.init?.body || '{}'))).toMatchObject({
      caption: 'private carousel',
      client_sidecar_id: '200',
      children_metadata: [{ upload_id: '201' }, { upload_id: '202' }],
    });
    expect(response).toEqual({ code: 'SIDE123', uploadIds: ['201', '202'] });
  });

  it('uses prepared assets when private carousel upload needs aspect-ratio normalization', async () => {
    const first = createTempFile('private-carousel-normalize-1.jpg', Buffer.from(
      'FFD8FFE000104A46494600010100000100010000FFC00011080004000603012200021101031101FFD9',
      'hex',
    ));
    const second = createTempFile('private-carousel-normalize-2.png', Buffer.from(
      '89504E470D0A1A0A0000000D49484452000000030000000508060000008D6F26E50000000049454E44AE426082',
      'hex',
    ));
    const calls: Array<{ url: string; init?: { method?: string; headers?: Record<string, string>; body?: unknown } }> = [];
    let uploadCounter = 0;
    const fetcher = async (url: string | URL, init?: { method?: string; headers?: Record<string, string>; body?: unknown }) => {
      calls.push({ url: String(url), init });
      if (String(url).includes('/rupload_igphoto/')) {
        uploadCounter += 1;
        return new Response(JSON.stringify({ upload_id: String(400 + uploadCounter), status: 'ok' }), { status: 200 });
      }
      return new Response('{"media":{"code":"SIDEPAD"}}', { status: 200 });
    };

    const preparedBytes = Buffer.from(
      '89504E470D0A1A0A0000000D49484452000007FD000009FC08060000008D6F26E50000000049454E44AE426082',
      'hex',
    );

    const response = await publishImagesViaPrivateApi({
      page: {} as never,
      imagePaths: [first, second],
      caption: 'private carousel normalized',
      apiContext: {
        asbdId: '359341',
        csrfToken: 'csrf-token',
        igAppId: '936619743392459',
        igWwwClaim: 'hmac.claim',
        instagramAjax: '1036517563',
        webSessionId: 'abc:def:ghi',
      },
      jazoest: '22047',
      now: () => 400,
      fetcher,
      prepareAsset: async (filePath) => {
        if (filePath === second) {
          return {
            filePath: '/tmp/normalized.png',
            fileName: 'normalized.png',
            mimeType: 'image/png',
            width: 2045,
            height: 2556,
            byteLength: preparedBytes.length,
            bytes: preparedBytes,
            cleanupPath: '/tmp/normalized.png',
          };
        }
        return readImageAsset(filePath);
      },
    });

    const secondUploadHeaders = calls[1]?.init?.headers ?? {};
    expect(JSON.parse(String(secondUploadHeaders['X-Instagram-Rupload-Params'] || '{}'))).toMatchObject({
      upload_media_width: 2045,
      upload_media_height: 2556,
    });
    expect(response).toEqual({ code: 'SIDEPAD', uploadIds: ['401', '402'] });
  });

  it('includes the response body when configure_sidecar returns a 400', async () => {
    const first = createTempFile('private-carousel-error-1.jpg', Buffer.from(
      'FFD8FFE000104A46494600010100000100010000FFC00011080004000603012200021101031101FFD9',
      'hex',
    ));
    const second = createTempFile('private-carousel-error-2.png', Buffer.from(
      '89504E470D0A1A0A0000000D49484452000000030000000508060000008D6F26E50000000049454E44AE426082',
      'hex',
    ));
    let uploadCounter = 0;
    const fetcher = async (url: string | URL) => {
      if (String(url).includes('/rupload_igphoto/')) {
        uploadCounter += 1;
        return new Response(JSON.stringify({ upload_id: String(300 + uploadCounter), status: 'ok' }), { status: 200 });
      }
      return new Response('{"message":"children_metadata invalid"}', { status: 400 });
    };

    await expect(publishImagesViaPrivateApi({
      page: {} as never,
      imagePaths: [first, second],
      caption: 'private carousel',
      apiContext: {
        asbdId: '359341',
        csrfToken: 'csrf-token',
        igAppId: '936619743392459',
        igWwwClaim: 'hmac.claim',
        instagramAjax: '1036517563',
        webSessionId: 'abc:def:ghi',
      },
      jazoest: '22047',
      now: () => 300,
      fetcher,
      prepareAsset: async (filePath) => readImageAsset(filePath),
    })).rejects.toThrow('children_metadata invalid');
  });

  it('retries transient rupload fetch failures and still completes the carousel publish', async () => {
    const first = createTempFile('private-carousel-retry-1.jpg', Buffer.from(
      'FFD8FFE000104A46494600010100000100010000FFC00011080004000603012200021101031101FFD9',
      'hex',
    ));
    const second = createTempFile('private-carousel-retry-2.png', Buffer.from(
      '89504E470D0A1A0A0000000D49484452000000030000000508060000008D6F26E50000000049454E44AE426082',
      'hex',
    ));
    const calls: string[] = [];
    let firstUploadAttempts = 0;
    let uploadCounter = 0;
    const fetcher = async (url: string | URL) => {
      const value = String(url);
      calls.push(value);
      if (value.includes('/rupload_igphoto/')) {
        firstUploadAttempts += value.includes('fb_uploader_501') ? 1 : 0;
        if (value.includes('fb_uploader_501') && firstUploadAttempts === 1) {
          throw new TypeError('fetch failed');
        }
        uploadCounter += 1;
        return new Response(JSON.stringify({ upload_id: String(500 + uploadCounter), status: 'ok' }), { status: 200 });
      }
      return new Response('{"media":{"code":"SIDERETRY"}}', { status: 200 });
    };

    const response = await publishImagesViaPrivateApi({
      page: {} as never,
      imagePaths: [first, second],
      caption: 'private carousel retry',
      apiContext: {
        asbdId: '359341',
        csrfToken: 'csrf-token',
        igAppId: '936619743392459',
        igWwwClaim: 'hmac.claim',
        instagramAjax: '1036517563',
        webSessionId: 'abc:def:ghi',
      },
      jazoest: '22047',
      now: () => 500,
      fetcher,
      prepareAsset: async (filePath) => readImageAsset(filePath),
    });

    expect(calls.filter((url) => url.includes('fb_uploader_501'))).toHaveLength(2);
    expect(response).toEqual({ code: 'SIDERETRY', uploadIds: ['501', '502'] });
  });

  it('does not retry transient configure_sidecar fetch failures to avoid duplicate posts', async () => {
    const first = createTempFile('private-carousel-no-retry-1.jpg', Buffer.from(
      'FFD8FFE000104A46494600010100000100010000FFC00011080004000603012200021101031101FFD9',
      'hex',
    ));
    const second = createTempFile('private-carousel-no-retry-2.png', Buffer.from(
      '89504E470D0A1A0A0000000D49484452000000030000000508060000008D6F26E50000000049454E44AE426082',
      'hex',
    ));
    const calls: string[] = [];
    let uploadCounter = 0;
    const fetcher = async (url: string | URL) => {
      const value = String(url);
      calls.push(value);
      if (value.includes('/rupload_igphoto/')) {
        uploadCounter += 1;
        return new Response(JSON.stringify({ upload_id: String(600 + uploadCounter), status: 'ok' }), { status: 200 });
      }
      throw new TypeError('fetch failed');
    };

    await expect(publishImagesViaPrivateApi({
      page: {} as never,
      imagePaths: [first, second],
      caption: 'private no retry configure',
      apiContext: {
        asbdId: '359341',
        csrfToken: 'csrf-token',
        igAppId: '936619743392459',
        igWwwClaim: 'hmac.claim',
        instagramAjax: '1036517563',
        webSessionId: 'abc:def:ghi',
      },
      jazoest: '22047',
      now: () => 600,
      fetcher,
      prepareAsset: async (filePath) => readImageAsset(filePath),
    })).rejects.toThrow('fetch failed');

    expect(calls.filter((url) => url.includes('configure_sidecar'))).toHaveLength(1);
  });

  it('publishes a mixed image/video carousel and polls configure_sidecar until transcoding finishes', async () => {
    const image = createTempFile('mixed-private-image.jpg', Buffer.from(
      'FFD8FFE000104A46494600010100000100010000FFC00011080004000603012200021101031101FFD9',
      'hex',
    ));
    const video = createTempFile('mixed-private-video.mp4', Buffer.from('video-binary'));
    const coverBytes = Buffer.from(
      'FFD8FFE000104A46494600010100000100010000FFC00011080168028003012200021101031101FFD9',
      'hex',
    );
    const calls: Array<{ url: string; init?: { method?: string; headers?: Record<string, string>; body?: unknown } }> = [];
    let configureAttempts = 0;
    const fetcher = async (url: string | URL, init?: { method?: string; headers?: Record<string, string>; body?: unknown }) => {
      const value = String(url);
      calls.push({ url: value, init });
      if (value.includes('/rupload_igphoto/') && value.includes('fb_uploader_701')) {
        return new Response('{"upload_id":"701","status":"ok"}', { status: 200 });
      }
      if (value.includes('/rupload_igvideo/') && value.includes('fb_uploader_702')) {
        return new Response('{"media_id":17944674009157009,"status":"ok"}', { status: 200 });
      }
      if (value.includes('/rupload_igphoto/') && value.includes('fb_uploader_702')) {
        return new Response('{"upload_id":"702","status":"ok"}', { status: 200 });
      }
      configureAttempts += 1;
      if (configureAttempts === 1) {
        return new Response('{"message":"Transcode not finished yet.","status":"fail"}', { status: 202 });
      }
      return new Response('{"status":"ok","media":{"code":"MIXEDSIDE123"}}', { status: 200 });
    };

    const response = await publishMediaViaPrivateApi({
      page: {} as never,
      mediaItems: [
        { type: 'image', filePath: image },
        { type: 'video', filePath: video },
      ],
      caption: 'mixed private carousel',
      apiContext: {
        asbdId: '359341',
        csrfToken: 'csrf-token',
        igAppId: '936619743392459',
        igWwwClaim: 'hmac.claim',
        instagramAjax: '1036517563',
        webSessionId: 'abc:def:ghi',
      },
      jazoest: '22047',
      now: () => 700,
      fetcher,
      prepareMediaAsset: async (item) => {
        if (item.type === 'image') {
          return {
            type: 'image' as const,
            asset: readImageAsset(item.filePath),
          };
        }
        return {
          type: 'video' as const,
          asset: {
            filePath: item.filePath,
            fileName: 'mixed-private-video.mp4',
            mimeType: 'video/mp4',
            width: 640,
            height: 360,
            durationMs: 28245,
            byteLength: 12,
            bytes: Buffer.from('video-binary'),
            coverImage: {
              filePath: '/tmp/mixed-private-cover.jpg',
              fileName: 'mixed-private-cover.jpg',
              mimeType: 'image/jpeg',
              width: 640,
              height: 360,
              byteLength: coverBytes.length,
              bytes: coverBytes,
            },
          },
        };
      },
      waitMs: async () => undefined,
    });

    expect(calls).toHaveLength(5);
    expect(calls[0]?.url).toContain('/rupload_igphoto/fb_uploader_701');
    expect(calls[1]?.url).toContain('/rupload_igvideo/fb_uploader_702');
    expect(calls[2]?.url).toContain('/rupload_igphoto/fb_uploader_702');
    expect(JSON.parse(String(calls[1]?.init?.headers?.['X-Instagram-Rupload-Params'] || '{}'))).toMatchObject({
      media_type: 2,
      upload_id: '702',
      upload_media_width: 640,
      upload_media_height: 360,
      upload_media_duration_ms: 28245,
      video_edit_params: {
        crop_width: 360,
        crop_height: 360,
        crop_x1: 140,
        crop_y1: 0,
        trim_start: 0,
        trim_end: 28.245,
        mute: false,
      },
    });
    expect(JSON.parse(String(calls[2]?.init?.headers?.['X-Instagram-Rupload-Params'] || '{}'))).toMatchObject({
      media_type: 2,
      upload_id: '702',
      upload_media_width: 640,
      upload_media_height: 360,
    });
    expect(JSON.parse(String(calls[3]?.init?.body || '{}'))).toMatchObject({
      caption: 'mixed private carousel',
      client_sidecar_id: '700',
      children_metadata: [{ upload_id: '701' }, { upload_id: '702' }],
    });
    expect(response).toEqual({ code: 'MIXEDSIDE123', uploadIds: ['701', '702'] });
  });
});
