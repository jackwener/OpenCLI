import * as os from 'node:os';
import * as path from 'node:path';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { saveBase64ToFile } from '@jackwener/opencli/utils';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError, TimeoutError } from '@jackwener/opencli/errors';

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

// Run main-world JS and return result via DOM side channel
async function runMainWorld(page, code) {
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
}

// Navigate to a URL and wait for a condition
async function navigateAndWait(page, url, condition, timeoutSecs) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const start = Date.now();
  while (Date.now() - start < timeoutSecs * 1000) {
    const result = await condition().catch(() => null);
    if (result) return result;
    await page.wait(0.5);
  }
  return null;
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
    { name: 'prompt', required: true, positional: true, help: 'Image prompt to generate' },
    { name: 'op', default: '~/Pictures/qwen-studio', help: 'Output directory' },
    { name: 'ratio', default: '16:9', help: 'Aspect ratio: 16:9, 1:1, 4:3, 9:16' },
    { name: 'sd', type: 'boolean', default: false, help: 'Skip download; only return the Qianwen link' },
    { name: 'timeout', type: 'int', default: 300, help: 'Max seconds to wait for image generation' },
  ],
  columns: ['Status', 'File', 'Link'],
  func: async (page, kwargs) => {
    const prompt = String(kwargs.prompt || '').trim();
    if (!prompt) throw new ArgumentError('prompt is required');
    const outputDir = String(kwargs.op || '~/Pictures/qwen-studio').replace(/^~\//, `${os.homedir()}/`);
    const ratio = String(kwargs.ratio || '16:9');
    const skipDownload = Boolean(kwargs.sd);
    const timeout = Number(kwargs.timeout ?? 300);
    if (!Number.isInteger(timeout) || timeout <= 0) throw new ArgumentError('timeout must be a positive integer');

    // ── Step 1: Open chat.qwen.ai and wait for sidebar ─────────────────────────
    await page.goto('https://chat.qwen.ai/', { waitUntil: 'domcontentloaded' });

    // Wait for sidebar with "新建對話" to appear (SPA hydration)
    let hydrated = false;
    for (let i = 0; i < 30; i++) {
      hydrated = await page.evaluate(() => {
        // Look for the new chat button text
        const els = Array.from(document.querySelectorAll('div'));
        return els.some(el => el.textContent.trim() === '新建對話' && el.offsetParent !== null);
      }).catch(() => false);
      if (hydrated) break;
      await page.wait(1);
    }
    if (!hydrated) throw new CommandExecutionError('Qwen Studio sidebar did not load within 30s');

    // ── Step 2: Click 新建對話 to open a new chat ───────────────────────────────
    const newChatClicked = await runMainWorld(page, `
      var divs = Array.from(document.querySelectorAll('div'));
      var newChatDiv = divs.find(d => d.textContent.trim() === '新建對話' && d.offsetParent !== null);
      if (!newChatDiv) return { ok: false, reason: 'no new chat div found' };
      // Find the closest parent that is a button or has onClick
      var parent = newChatDiv.parentElement;
      while (parent && !parent.onClick && parent.tagName !== 'BUTTON') {
        parent = parent.parentElement;
      }
      var el = parent && (parent.onClick || parent.tagName === 'BUTTON') ? parent : newChatDiv;
      var propsKey = Object.keys(el).find(k => k.startsWith('__reactProps'));
      if (propsKey && el[propsKey]?.onClick) {
        try { el[propsKey].onClick({ target: el, currentTarget: el, type: 'click', preventDefault: ()=>{}, stopPropagation: ()=>{} }); }
        catch(e) { return { ok: false, reason: 'onClick err: ' + e.message }; }
        return { ok: true, method: 'onClick' };
      }
      el.click();
      return { ok: true, method: 'native' };
    `);
    if (!newChatClicked?.ok) throw new CommandExecutionError(`New chat click failed: ${newChatClicked?.reason}`);

    // Wait for chat area to load (textarea or mode toggle should appear)
    let chatAreaLoaded = false;
    for (let i = 0; i < 20; i++) {
      chatAreaLoaded = await page.evaluate(() => {
        // Look for the chat textarea or the mode toggle
        const ta = document.querySelector('textarea');
        const modeToggle = Array.from(document.querySelectorAll('span')).find(s => s.textContent === '自動' || s.textContent === '創建圖像');
        return !!(ta || modeToggle);
      }).catch(() => false);
      if (chatAreaLoaded) break;
      await page.wait(1);
    }

    // ── Step 3: Check if we're in image creation mode already ─────────────────
    // If textarea placeholder is "描述你想要生成的圖像。" we're already in image mode
    const inImageMode = await page.evaluate(() => {
      const ta = document.querySelector('textarea');
      return ta && ta.placeholder && ta.placeholder.includes('描述');
    }).catch(() => false);

    if (!inImageMode) {
      // Need to switch to image creation mode via the mode toggle
      // The mode toggle is a div/span containing the current mode text (通常"自動")
      // We need to find and click it, then select "創建圖像" from the dropdown

      // First, try to find and click the mode toggle (look for the div containing "自動")
      const modeToggleResult = await runMainWorld(page, `
        // Find all divs containing "自動" text that are visible
        var divs = Array.from(document.querySelectorAll('div'));
        var autoDiv = divs.find(d => d.textContent.trim() === '自動' && d.offsetParent !== null);
        if (!autoDiv) return { ok: false, reason: 'no auto div' };
        // Walk up to find clickable element
        var el = autoDiv;
        for (var i = 0; i < 5 && el; i++) {
          var pk = Object.keys(el).find(k => k.startsWith('__reactProps'));
          if (el.onClick || (pk && el[pk]?.onClick)) break;
          el = el.parentElement;
        }
        if (!el) return { ok: false, reason: 'no clickable parent found' };
        var propsKey = Object.keys(el).find(k => k.startsWith('__reactProps'));
        if (propsKey && el[propsKey]?.onClick) {
          try { el[propsKey].onClick({ target: el, currentTarget: el, type: 'click', preventDefault: ()=>{}, stopPropagation: ()=>{} }); }
          catch(e) { return { ok: false, reason: 'onClick err: ' + e.message }; }
          return { ok: true, method: 'onClick' };
        }
        el.click();
        return { ok: true, method: 'native' };
      `);

      if (!modeToggleResult?.ok) throw new CommandExecutionError(`Mode toggle click failed: ${modeToggleResult?.reason}`);
      await page.wait(1);

      // Now look for "創建圖像" in the dropdown that should appear
      // The dropdown options are divs with role=option or menuitem
      const imageOptionResult = await runMainWorld(page, `
        // Wait a moment for dropdown to animate in
        var options = Array.from(document.querySelectorAll('[role=\"option\"], [role=\"menuitem\"]'));
        var imgOption = options.find(o => o.textContent.includes('創建圖像'));
        if (imgOption) {
          var propsKey = Object.keys(imgOption).find(k => k.startsWith('__reactProps'));
          if (propsKey && imgOption[propsKey]?.onClick) {
            try { imgOption[propsKey].onClick({ target: imgOption, currentTarget: imgOption, type: 'click', preventDefault: ()=>{}, stopPropagation: ()=>{} }); }
            catch(e) { return { ok: false, reason: 'onClick err: ' + e.message }; }
            return { ok: true, method: 'onClick' };
          }
          imgOption.click();
          return { ok: true, method: 'clicked' };
        }
        return { ok: false, reason: 'no create image option found', optionCount: options.length, optionTexts: options.slice(0,5).map(o => o.textContent.substring(0,20)) };
      `);

      // If "創建圖像" not in dropdown, try finding it as a direct clickable element
      if (!imageOptionResult?.ok) {
        // Try clicking a div containing "創建圖像" directly
        const directClick = await runMainWorld(page, `
          var divs = Array.from(document.querySelectorAll('div'));
          var createImgDiv = divs.find(d => d.textContent.trim() === '創建圖像' && d.offsetParent !== null);
          if (!createImgDiv) return { ok: false, reason: 'no create image div' };
          var propsKey = Object.keys(createImgDiv).find(k => k.startsWith('__reactProps'));
          if (propsKey && createImgDiv[propsKey]?.onClick) {
            try { createImgDiv[propsKey].onClick({ target: createImgDiv, currentTarget: createImgDiv, type: 'click', preventDefault: ()=>{}, stopPropagation: ()=>{} }); }
            catch(e) { return { ok: false, reason: 'onClick err: ' + e.message }; }
            return { ok: true, method: 'onClick' };
          }
          createImgDiv.click();
          return { ok: true, method: 'native' };
        `);
        if (!directClick?.ok) throw new CommandExecutionError(`Could not find image creation mode: ${directClick?.reason || imageOptionResult?.reason}`);
      }
    }

    // Wait for the image creation textarea to appear
    let taReady = false;
    for (let i = 0; i < 15; i++) {
      taReady = await page.evaluate(() => {
        const ta = document.querySelector('textarea');
        return ta && ta.placeholder && ta.placeholder.includes('描述');
      }).catch(() => false);
      if (taReady) break;
      await page.wait(1);
    }
    if (!taReady) throw new CommandExecutionError('Image creation textarea did not appear');

    // ── Step 4: Set ratio if needed ─────────────────────────────────────────────
    // The ratio button is near the textarea - click to expand options
    await runMainWorld(page, `
      // Try to find and click a ratio option (16:9, 1:1, etc.)
      var ratio = '${ratio}';
      var divs = Array.from(document.querySelectorAll('div'));
      var ratioDiv = divs.find(d => d.textContent.trim() === ratio && d.offsetParent !== null);
      if (ratioDiv) {
        var propsKey = Object.keys(ratioDiv).find(k => k.startsWith('__reactProps'));
        if (propsKey && ratioDiv[propsKey]?.onClick) {
          try { ratioDiv[propsKey].onClick({ target: ratioDiv, currentTarget: ratioDiv, type: 'click', preventDefault: ()=>{}, stopPropagation: ()=>{} }); }
          catch(e) { return { ok: false, reason: 'onClick err: ' + e.message }; }
          return { ok: true };
        }
        ratioDiv.click();
        return { ok: true };
      }
      return { ok: false, reason: 'ratio not found: ' + ratio };
    `).catch(() => ({}));
    await page.wait(0.5);

    // ── Step 5: Type prompt via React state ─────────────────────────────────────
    const typed = await runMainWorld(page, `
      var t = document.querySelector('textarea');
      if (!t) return { ok: false, reason: 'no textarea' };
      t.focus();
      var propsKey = Object.keys(t).find(k => k.startsWith('__reactProps'));
      if (!propsKey) return { ok: false, reason: 'no reactProps' };
      var props = t[propsKey];
      if (!props || !props.onChange) return { ok: false, reason: 'no onChange' };
      var nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      nativeSetter.call(t, ${JSON.stringify(prompt)});
      t.dispatchEvent(new Event('input', { bubbles: true }));
      try {
        props.onChange({ target: t, currentTarget: t, type: 'change', bubbles: true });
      } catch (e) {
        return { ok: false, reason: 'onChange err: ' + e.message, after: t.value };
      }
      return { ok: true, val: t.value };
    `);
    if (!typed?.ok) throw new CommandExecutionError(`Type failed: ${typed?.reason}`);
    await page.wait(0.5);

    // ── Step 6: Click the create/generate button ────────────────────────────────
    // The button has "創建圖像" text and is near the textarea
    const createClicked = await runMainWorld(page, `
      // Find the button with "創建圖像" text that's near the textarea
      var btns = Array.from(document.querySelectorAll('button, div[role=\"button\"]'));
      var createBtn = btns.find(b => b.offsetParent !== null && (
        b.textContent.includes('創建') || b.getAttribute('aria-label')?.includes('創建')
      ));
      if (createBtn) {
        var propsKey = Object.keys(createBtn).find(k => k.startsWith('__reactProps'));
        if (propsKey && createBtn[propsKey]?.onClick) {
          try { createBtn[propsKey].onClick({ target: createBtn, currentTarget: createBtn, type: 'click', preventDefault: ()=>{}, stopPropagation: ()=>{} }); }
          catch(e) { return { ok: false, reason: 'onClick err: ' + e.message }; }
          return { ok: true, method: 'onClick' };
        }
        createBtn.click();
        return { ok: true, method: 'click' };
      }
      // Fallback: find any visible button in the form area
      var ta = document.querySelector('textarea');
      if (!ta) return { ok: false, reason: 'no textarea' };
      var formArea = ta.closest('div');
      if (formArea) {
        var nearbyBtns = formArea.querySelectorAll('button');
        for (var i = 0; i < nearbyBtns.length; i++) {
          var b = nearbyBtns[i];
          if (b.offsetParent !== null) {
            var propsKey = Object.keys(b).find(k => k.startsWith('__reactProps'));
            if (propsKey && b[propsKey]?.onClick) {
              try { b[propsKey].onClick({ target: b, currentTarget: b, type: 'click', preventDefault: ()=>{}, stopPropagation: ()=>{} }); }
              catch(e) { return { ok: false, reason: 'onClick err: ' + e.message }; }
              return { ok: true, method: 'onClick' };
            }
            b.click();
            return { ok: true, method: 'click' };
          }
        }
      }
      return { ok: false, reason: 'no create button found' };
    `);
    if (!createClicked?.ok) throw new CommandExecutionError(`Create button click failed: ${createClicked?.reason}`);

    // ── Step 7: Wait for URL to change to /c/{uuid} ─────────────────────────────
    let chatId = null;
    for (let i = 0; i < 30; i++) {
      const url = await page.evaluate(() => window.location.href).catch(() => '');
      const match = url.match(/\/c\/([^/?#]+)/);
      const candidate = match ? match[1] : null;
      if (candidate && candidate !== 'new-chat') { chatId = candidate; break; }
      await page.wait(1);
    }
    if (!chatId) throw new CommandExecutionError('URL did not change to /c/{UUID} after sending image prompt');

    // ── Step 8: Poll for image URLs in the page DOM ─────────────────────────────
    const startTime = Date.now();
    let imageUrls = [];
    let lastUrls = [];

    while (Date.now() - startTime < timeout * 1000) {
      await page.wait(2);
      const urls = await page.evaluate(() => {
        const imgs = Array.from(document.querySelectorAll('img')).filter(img =>
          img.src && img.src.includes('cdn.qwenlm.ai') && img.naturalWidth > 0
        ).map(img => img.src);
        return [...new Set(imgs)];
      });

      if (urls.length && urls.length === lastUrls.length && urls.every((u, i) => u === lastUrls[i])) {
        imageUrls = urls;
        break;
      }
      if (urls.length > 0) {
        await page.wait(1);
        const urls2 = await page.evaluate(() => {
          const imgs = Array.from(document.querySelectorAll('img')).filter(img =>
            img.src && img.src.includes('cdn.qwenlm.ai') && img.naturalWidth > 0
          ).map(img => img.src);
          return [...new Set(imgs)];
        });
        if (urls2.length === urls.length) {
          imageUrls = urls2;
          break;
        }
        lastUrls = urls2;
      }
      lastUrls = urls;
    }

    if (imageUrls.length === 0) {
      throw new TimeoutError('qwen-studio image', timeout, `No generated images found within ${timeout}s`);
    }

    if (skipDownload) {
      return imageUrls.map(url => ({ Status: 'generated', File: null, Link: url }));
    }

    // ── Step 9: Download images ─────────────────────────────────────────────────
    const stamp = Date.now();
    const results = [];
    for (let i = 0; i < imageUrls.length; i++) {
      const url = imageUrls[i];
      const asset = await page.evaluate(async (imgUrl) => {
        try {
          const res = await fetch(imgUrl, { credentials: 'include' });
          if (!res.ok) return { ok: false, status: res.status };
          const mime = res.headers.get('content-type') || 'image/png';
          const buf = await res.arrayBuffer();
          const bytes = new Uint8Array(buf);
          let binary = '';
          const chunk = 0x8000;
          for (let i = 0; i < bytes.length; i += chunk) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
          }
          return { ok: true, mime, base64: btoa(binary) };
        } catch (error) {
          return { ok: false, error: String(error?.message || error) };
        }
      }, url);

      if (!asset?.ok) {
        throw new CommandExecutionError(`Failed to fetch generated image ${i + 1}: ${asset?.error || 'status=' + asset?.status}`);
      }

      const suffix = imageUrls.length > 1 ? `_${i + 1}` : '';
      const ext = extFromMime(asset.mime);
      const filePath = path.join(outputDir, `qwen_studio_${stamp}${suffix}${ext}`);
      await saveBase64ToFile(asset.base64, filePath);
      results.push({ Status: 'saved', File: displayPath(filePath), Link: url });
    }

    return results;
  },
});