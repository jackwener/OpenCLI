import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as https from 'node:https';
import * as http from 'node:http';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { saveBase64ToFile } from '@jackwener/opencli/utils';
import { ArgumentError, CommandExecutionError, TimeoutError } from '@jackwener/opencli/errors';

const SIDE_CHANNEL_ID = '__opencli_image_side_channel__';

function displayPath(filePath) {
  const home = os.homedir();
  return filePath.startsWith(home) ? `~${filePath.slice(home.length)}` : filePath;
}

function extFromMime(mime) {
  if (!mime) return '.png';
  if (mime.includes('png')) return '.png';
  if (mime.includes('webp')) return '.webp';
  if (mime.includes('gif')) return '.gif';
  if (mime.includes('jpeg') || mime.includes('jpg')) return '.jpg';
  return '.png';
}

function downloadToBuffer(imageUrl) {
  return new Promise((resolve) => {
    const protocol = imageUrl.startsWith('https') ? https : http;
    const req = protocol.get(imageUrl, { headers: { Accept: 'image/*' } }, (res) => {
      if (res.statusCode !== 200) {
        resolve({ ok: false, status: res.statusCode });
        return;
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const mime = res.headers['content-type'] || 'image/png';
        resolve({ ok: true, mime, buffer: buf });
      });
    });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.setTimeout(30000, () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
  });
}

cli({
  site: 'qwen-studio',
  name: 'image',
  description: 'Generate images with Qwen Studio (chat.qwen.ai) and save them locally',
  access: 'write',
  domain: 'chat.qwen.ai',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  defaultFormat: 'plain',
  args: [
    { name: 'prompt', required: true, positional: true, help: 'Image prompt to generate (e.g. "一隻可愛的貓")' },
    { name: 'op', default: '~/Pictures/qwen-studio', help: 'Output directory' },
    { name: 'sd', type: 'boolean', default: false, help: 'Skip download; only return the image links' },
    { name: 'timeout', type: 'int', default: 300, help: 'Max seconds to wait for image generation' },
  ],
  columns: ['Status', 'File', 'Link'],
  func: async (page, kwargs) => {
    const prompt = String(kwargs.prompt || '').trim();
    if (!prompt) throw new ArgumentError('prompt is required');
    const outputDir = String(kwargs.op || '~/Pictures/qwen-studio').replace(/^~\//, `${os.homedir()}/`);
    const skipDownload = Boolean(kwargs.sd);
    const timeout = Number(kwargs.timeout ?? 300);
    if (!Number.isInteger(timeout) || timeout <= 0) throw new ArgumentError('timeout must be a positive integer');

    // Helper: run main-world code, return result via DOM side-channel
    const runMainWorld = async (code) => {
      await page.evaluate((id) => {
        let el = document.getElementById(id);
        if (!el) { el = document.createElement('div'); el.id = id; el.style.display = 'none'; document.body.appendChild(el); }
        el.textContent = '';
        el.dataset.value = '';
      }, SIDE_CHANNEL_ID);

      await page.evaluate((c, id) => {
        const s = document.createElement('script');
        s.textContent = `try { var __r = (function(){${c}})(); document.getElementById('${id}').dataset.value = JSON.stringify(__r); } catch(e) { document.getElementById('${id}').dataset.value = JSON.stringify({ ok:false, reason:'scriptErr: ' + e.message }); }`;
        document.head.appendChild(s);
        s.remove();
      }, code, SIDE_CHANNEL_ID);

      const raw = await page.evaluate((id) => document.getElementById(id)?.dataset?.value, SIDE_CHANNEL_ID);
      try { return JSON.parse(raw); } catch { return { ok: false, reason: 'parseErr', raw }; }
    };

    // ── Step 1: Navigate to chat.qwen.ai ───────────────────────────────────────
    await page.goto('https://chat.qwen.ai/', { waitUntil: 'domcontentloaded' });

    // Wait for hydration (textarea appears)
    let hydrated = false;
    for (let i = 0; i < 30; i++) {
      hydrated = await page.evaluate(() => {
        const ta = document.querySelector('textarea');
        return ta && ta.offsetParent !== null;
      }).catch(() => false);
      if (hydrated) break;
      await page.wait(1);
    }
    if (!hydrated) {
      const url = await page.evaluate(() => window.location.href).catch(() => 'unknown');
      throw new CommandExecutionError(`Qwen Studio SPA did not hydrate within 30s. URL: ${url}`);
    }

    // ── Step 2: Type the image generation prompt ───────────────────────────────
    // Wrap prompt in image generation request
    const imagePrompt = `請生成一張圖片：${prompt}`;

    const typed = await runMainWorld(`
      var t = document.querySelector('textarea');
      if (!t) return { ok: false, reason: 'no textarea' };
      t.focus();
      var propsKey = Object.keys(t).find(k => k.startsWith('__reactProps'));
      if (!propsKey) return { ok: false, reason: 'no reactProps' };
      var props = t[propsKey];
      if (!props || !props.onChange) return { ok: false, reason: 'no onChange' };
      var nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      nativeSetter.call(t, ${JSON.stringify(imagePrompt)});
      t.dispatchEvent(new Event('input', { bubbles: true }));
      try {
        props.onChange({ target: t, currentTarget: t, type: 'change', bubbles: true });
      } catch (e) {
        return { ok: false, reason: 'onChange err: ' + e.message, after: t.value };
      }
      return { ok: true, val: t.value };
    `);
    if (!typed?.ok) throw new CommandExecutionError(`Type failed: ${typed?.reason || 'unknown'}`);

    // ── Step 3: Wait for send button to appear ─────────────────────────────────
    let sendReady = false;
    for (let i = 0; i < 10; i++) {
      sendReady = await page.evaluate(() => {
        const ta = document.querySelector('textarea');
        if (!ta) return false;
        const btn = ta.parentElement?.querySelector('button.send-button')
          || Array.from(document.querySelectorAll('button')).find(b =>
            b.className && b.className.includes && b.className.includes('send-button') && b.offsetParent !== null
          );
        return !!btn;
      }).catch(() => false);
      if (sendReady) break;
      await page.wait(1);
    }
    if (!sendReady) throw new CommandExecutionError('Send button did not appear after typing');

    // ── Step 4: Click send ─────────────────────────────────────────────────────
    const clicked = await runMainWorld(`
      var ta = document.querySelector('textarea');
      var btn = ta && ta.parentElement && ta.parentElement.querySelector('button.send-button');
      if (!btn) {
        btn = Array.from(document.querySelectorAll('button')).find(b =>
          b.className && b.className.includes && b.className.includes('send-button') && b.offsetParent !== null
        );
      }
      if (!btn) return { ok: false, reason: 'no send button' };
      var propsKey = Object.keys(btn).find(k => k.startsWith('__reactProps'));
      var props = propsKey ? btn[propsKey] : null;
      if (props && props.onClick) {
        try { props.onClick({ target: btn, currentTarget: btn, type: 'click', preventDefault: function(){}, stopPropagation: function(){} }); }
        catch (e) { return { ok: false, reason: 'onClick err: ' + e.message }; }
        return { ok: true, method: 'onClick-direct' };
      }
      btn.click();
      return { ok: true, method: 'native-click' };
    `);
    if (!clicked?.ok) throw new CommandExecutionError(`Send click failed: ${clicked?.reason}`);

    // ── Step 5: Wait for URL to change to /c/{uuid} ───────────────────────────
    let chatId = null;
    for (let i = 0; i < 30; i++) {
      const url = await page.evaluate(() => window.location.href).catch(() => '');
      const match = url.match(/\/c\/([^/]+)/);
      const candidate = match ? match[1] : null;
      if (candidate && candidate !== 'new-chat') { chatId = candidate; break; }
      await page.wait(1);
    }
    if (!chatId) throw new CommandExecutionError('URL did not change to /c/{UUID} after send (timeout)');

    // ── Step 6: Poll for generated images in DOM ───────────────────────────────
    // Images appear as <img> tags with cdn.qwenlm.ai src after generation completes
    const startTime = Date.now();
    let imageUrls = [];
    let lastUrls = [];
    let stableCount = 0;

    while (Date.now() - startTime < timeout * 1000) {
      await page.wait(2);

      const urls = await page.evaluate(() => {
        const imgs = Array.from(document.querySelectorAll('img')).filter(img =>
          img.src && img.src.includes('cdn.qwenlm.ai') && img.naturalWidth > 0
        ).map(img => img.src);
        return [...new Set(imgs)];
      }).catch(() => []);

      // Image is stable when we see the same URLs twice in a row
      if (urls.length > 0 && urls.length === lastUrls.length && urls.every((u, i) => u === lastUrls[i])) {
        stableCount++;
        if (stableCount >= 2) {
          imageUrls = urls;
          break;
        }
      } else {
        stableCount = 0;
      }

      lastUrls = urls;

      // Check for generation failure indicators
      const hasError = await page.evaluate(() => {
        const errorEls = Array.from(document.querySelectorAll('div')).filter(el =>
          el.textContent.includes('生成失敗') || el.textContent.includes('generation failed') ||
          el.textContent.includes('error') || el.textContent.includes('錯誤')
        );
        return errorEls.length > 0;
      }).catch(() => false);

      if (hasError) {
        throw new CommandExecutionError('Image generation failed according to page content');
      }
    }

    if (imageUrls.length === 0) {
      throw new TimeoutError('qwen-studio image', timeout, `No generated images found within ${timeout}s. Chat ID: ${chatId}`);
    }

    if (skipDownload) {
      return imageUrls.map(url => ({ Status: 'generated', File: null, Link: url }));
    }

    // ── Step 7: Download images ─────────────────────────────────────────────────
    const stamp = Date.now();
    const results = [];

    for (let i = 0; i < imageUrls.length; i++) {
      const url = imageUrls[i];
      const suffix = imageUrls.length > 1 ? `_${i + 1}` : '';
      let mime = 'image/png';
      let data;

      const browserFetch = await page.evaluate(async (imgUrl) => {
        try {
          const res = await fetch(imgUrl, { credentials: 'include' });
          if (!res.ok) return { ok: false, status: res.status };
          const ct = res.headers.get('content-type') || 'image/png';
          const buf = await res.arrayBuffer();
          const bytes = new Uint8Array(buf);
          let binary = '';
          for (let j = 0; j < bytes.length; j += 0x8000) {
            binary += String.fromCharCode.apply(null, bytes.subarray(j, j + 0x8000));
          }
          return { ok: true, mime: ct, base64: btoa(binary) };
        } catch (e) {
          return { ok: false, error: e.message };
        }
      }, url).catch((e) => ({ ok: false, error: e.message }));

      if (browserFetch?.ok) {
        mime = browserFetch.mime;
        data = Buffer.from(browserFetch.base64, 'base64');
      } else {
        const nodeResult = await downloadToBuffer(url);
        if (!nodeResult.ok) {
          results.push({ Status: 'url', File: null, Link: url });
          continue;
        }
        mime = nodeResult.mime;
        data = nodeResult.buffer;
      }

      const ext = extFromMime(mime);
      const filePath = path.join(outputDir, `qwen_studio_${stamp}${suffix}${ext}`);
      await fs.promises.writeFile(filePath, data);
      results.push({ Status: 'saved', File: displayPath(filePath), Link: url });
    }

    return results;
  },
});