/**
 * Yollomi API utilities — browser cookie strategy.
 *
 * Uses the same per-model API routes as the Yollomi frontend:
 *   POST /api/ai/<model>   — image generation (session cookie auth)
 *   POST /api/ai/video     — video generation (session cookie auth)
 *
 * Auth: browser session cookies from NextAuth — just log in to yollomi.com in Chrome.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { IPage } from '../../src/types.js';
import { CliError } from '../../src/errors.js';

export const YOLLOMI_DOMAIN = 'yollomi.com';

/**
 * Ensure the browser tab is on yollomi.com.
 * The framework pre-nav sometimes silently fails, leaving the page on about:blank.
 */
export async function ensureOnYollomi(page: IPage): Promise<void> {
  const currentUrl = await page.evaluate(`(() => location.href)()`) as string;
  if (!currentUrl || !currentUrl.includes('yollomi.com')) {
    await page.goto('https://yollomi.com');
    await page.wait(3);
  }
}

/**
 * POST to a Yollomi /api/ai/* route via the browser session.
 * Uses relative paths (e.g. `/api/ai/flux`) — same as the frontend.
 */
export async function yollomiPost(page: IPage, apiPath: string, body: Record<string, unknown>): Promise<any> {
  const bodyJson = JSON.stringify(body);
  await ensureOnYollomi(page);

  const result = await page.evaluate(`
    (async () => {
      try {
        const res = await fetch(${JSON.stringify(apiPath)}, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: ${JSON.stringify(bodyJson)},
        });
        const text = await res.text();
        return { ok: res.ok, status: res.status, body: text };
      } catch (err) {
        return { ok: false, status: 0, body: err.message || 'fetch failed (on ' + location.href + ')' };
      }
    })()
  `);

  if (!result || result.status === 0) {
    throw new CliError(
      'FETCH_ERROR',
      `Network error: ${result?.body || 'Failed to fetch'}`,
      'Make sure Chrome is logged in to https://yollomi.com and the Browser Bridge is running',
    );
  }

  if (!result.ok) {
    let detail = result.body;
    try { detail = JSON.parse(result.body)?.error || JSON.parse(result.body)?.message || result.body; } catch {}
    throw new CliError(
      'API_ERROR',
      `Yollomi API ${result.status}: ${detail}`,
      result.status === 401
        ? 'Not logged in — open Chrome, go to https://yollomi.com and log in'
        : result.status === 402
          ? 'Insufficient credits — top up at https://yollomi.com/pricing'
          : result.status === 429
            ? 'Rate limited — wait a moment and retry'
            : 'Check the model and parameters',
    );
  }

  try {
    return JSON.parse(result.body);
  } catch {
    throw new CliError('API_ERROR', 'Invalid JSON response', 'Try again');
  }
}

/**
 * Resolve an image input: local file → base64 data URL, URL → as-is.
 */
export function resolveImageInput(input: string): string {
  if (input.startsWith('http://') || input.startsWith('https://') || input.startsWith('data:')) {
    return input;
  }

  const resolved = path.resolve(input);
  if (!fs.existsSync(resolved)) {
    throw new CliError('FILE_NOT_FOUND', `File not found: ${resolved}`, 'Provide a valid file path or URL');
  }

  const ext = path.extname(resolved).toLowerCase();
  const mimeMap: Record<string, string> = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.png': 'image/png', '.gif': 'image/gif',
    '.webp': 'image/webp', '.bmp': 'image/bmp',
  };
  const mime = mimeMap[ext] || 'image/png';
  const data = fs.readFileSync(resolved);
  return `data:${mime};base64,${data.toString('base64')}`;
}

export async function downloadOutput(
  url: string, outputDir: string, filename: string,
): Promise<{ path: string; size: number }> {
  fs.mkdirSync(outputDir, { recursive: true });
  const destPath = path.join(outputDir, filename);
  const resp = await fetch(url);
  if (!resp.ok) throw new CliError('DOWNLOAD_ERROR', `Download failed: HTTP ${resp.status}`, 'URL may have expired');
  const buffer = Buffer.from(await resp.arrayBuffer());
  fs.writeFileSync(destPath, buffer);
  return { path: destPath, size: buffer.length };
}

export function fmtBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

/** Per-model API route mapping (matches frontend model.apiEndpoint). */
export const MODEL_ROUTES: Record<string, string> = {
  'flux':                      '/api/ai/flux',
  'flux-schnell':              '/api/ai/flux-schnell',
  'flux-2-pro':                '/api/ai/flux-2-pro',
  'flux-kontext-pro':          '/api/ai/flux-kontext-pro',
  'nano-banana':               '/api/ai/nano-banana',
  'nano-banana-pro':           '/api/ai/nano-banana-pro',
  'nano-banana-2':             '/api/ai/nano-banana-2',
  'z-image-turbo':             '/api/ai/z-image-turbo',
  'imagen-4-ultra':            '/api/ai/imagen-4-ultra',
  'imagen-4-fast':             '/api/ai/imagen-4-fast',
  'ideogram-v3-turbo':         '/api/ai/ideogram-v3-turbo',
  'stable-diffusion-3-5-large':'/api/ai/stable-diffusion-3-5-large',
  'seedream-4-5':              '/api/ai/seedream-4-5',
  'seedream-5-lite':           '/api/ai/seedream-5-lite',
  'qwen-image-edit':           '/api/ai/qwen-image-edit',
  'qwen-image-edit-plus':      '/api/ai/qwen-image-edit-plus',
  'remove-bg':                 '/api/ai/remove-bg',
  'image-upscaler':            '/api/ai/image-upscaler',
  'face-swap':                 '/api/ai/face-swap',
  'virtual-try-on':            '/api/ai/virtual-try-on',
  'photo-restoration':         '/api/ai/photo-restoration',
  'ai-background-generator':   '/api/ai/ai-background-generator',
  'object-remover':            '/api/ai/object-remover',
};

/** Well-known image model IDs and their credit costs. */
export const IMAGE_MODELS: Record<string, { credits: number; description: string }> = {
  'z-image-turbo':             { credits: 1,  description: 'Alibaba Qwen turbo (cheapest, 1 credit)' },
  'flux-schnell':              { credits: 2,  description: 'High-speed Flux generation' },
  'ideogram-v3-turbo':         { credits: 3,  description: 'Ideogram V3 Turbo' },
  'imagen-4-fast':             { credits: 3,  description: 'Google Imagen 4 Fast' },
  'seedream-4-5':              { credits: 4,  description: 'Seedream 4.5 (ByteDance)' },
  'seedream-5-lite':           { credits: 4,  description: 'Seedream 5 Lite — 2K/3K' },
  'flux':                      { credits: 4,  description: 'Flux 1.1 Pro' },
  'nano-banana':               { credits: 4,  description: 'Google Nano Banana' },
  'flux-kontext-pro':          { credits: 4,  description: 'Flux Kontext Pro (img2img)' },
  'imagen-4-ultra':            { credits: 6,  description: 'Google Imagen 4 Ultra' },
  'nano-banana-2':             { credits: 7,  description: 'Google Nano Banana 2' },
  'stable-diffusion-3-5-large':{ credits: 7,  description: 'Stable Diffusion 3.5 Large' },
  'nano-banana-pro':           { credits: 15, description: 'Nano Banana Pro' },
  'flux-2-pro':                { credits: 15, description: 'Flux 2 Pro (premium)' },
};

export const VIDEO_MODELS: Record<string, { credits: number; description: string }> = {
  'kling-v2-6-motion-control':     { credits: 7,  description: 'Kling v2.6 Motion Control' },
  'bytedance-seedance-1-pro-fast': { credits: 8,  description: 'Seedance 1.0 Pro Fast' },
  'kling-2-1':                     { credits: 9,  description: 'Kling 2.1' },
  'minimax-hailuo-2-3':            { credits: 9,  description: 'Hailuo 2.3' },
  'pixverse-5':                    { credits: 9,  description: 'PixVerse 5' },
  'wan-2-5-t2v':                   { credits: 9,  description: 'Wan 2.5 Text-to-Video' },
  'wan-2-5-i2v':                   { credits: 9,  description: 'Wan 2.5 Image-to-Video' },
  'google-veo-3-fast':             { credits: 9,  description: 'Google Veo 3 Fast' },
  'google-veo-3-1-fast':           { credits: 9,  description: 'Google Veo 3.1 Fast' },
  'openai-sora-2':                 { credits: 10, description: 'Sora 2' },
  'google-veo-3':                  { credits: 10, description: 'Google Veo 3' },
  'google-veo-3-1':                { credits: 10, description: 'Google Veo 3.1' },
  'wan-2-6-t2v':                   { credits: 29, description: 'Wan 2.6 T2V (premium)' },
  'wan-2-6-i2v':                   { credits: 29, description: 'Wan 2.6 I2V (premium)' },
};

export const TOOL_MODELS: Record<string, { credits: number; description: string }> = {
  'remove-bg':              { credits: 0, description: 'Remove background (free)' },
  'image-upscaler':         { credits: 1, description: 'Enhance image resolution' },
  'object-remover':         { credits: 3, description: 'Remove unwanted objects' },
  'face-swap':              { credits: 3, description: 'Swap faces in photos' },
  'virtual-try-on':         { credits: 3, description: 'Try clothes on photos' },
  'qwen-image-edit':        { credits: 3, description: 'Edit image with text prompt' },
  'qwen-image-edit-plus':   { credits: 3, description: 'Advanced image editing' },
  'photo-restoration':      { credits: 4, description: 'Revive old/damaged photos' },
  'ai-background-generator':{ credits: 5, description: 'Generate custom backgrounds' },
};
