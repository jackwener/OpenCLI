/**
 * Xiaohongshu 图文笔记 publisher — creator center UI automation.
 *
 * Flow:
 *   1. Navigate to creator publish page
 *   2. Upload images via DataTransfer injection into the file input
 *   3. Fill title and body text
 *   4. Add topic hashtags
 *   5. Publish (or save as draft)
 *
 * Requires: logged into creator.xiaohongshu.com in Chrome.
 *
 * Usage:
 *   opencli xiaohongshu publish --title "标题" "正文内容" \
 *     --images /path/a.jpg,/path/b.jpg \
 *     --topics 生活,旅行
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';

const PUBLISH_URL = 'https://creator.xiaohongshu.com/publish/publish?from=menu_left';
const MAX_IMAGES = 9;
const MAX_TITLE_LEN = 20;
const UPLOAD_SETTLE_MS = 3000;

type ImagePayload = { name: string; mimeType: string; base64: string };

/**
 * Read a local image and return the name, MIME type, and base64 content.
 * Throws if the file does not exist or the extension is unsupported.
 */
function readImageFile(filePath: string): ImagePayload {
  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) throw new Error(`Image file not found: ${absPath}`);
  const ext = path.extname(absPath).toLowerCase();
  const mimeMap: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
  };
  const mimeType = mimeMap[ext];
  if (!mimeType) throw new Error(`Unsupported image format "${ext}". Supported: jpg, png, gif, webp`);
  const base64 = fs.readFileSync(absPath).toString('base64');
  return { name: path.basename(absPath), mimeType, base64 };
}

/**
 * Inject images into the page's file input using DataTransfer.
 * Converts base64 payloads to File objects in the browser context, then dispatches
 * a synthetic 'change' event on the input element.
 *
 * Returns { ok, count, error }.
 */
async function injectImages(page: IPage, images: ImagePayload[]): Promise<{ ok: boolean; count: number; error?: string }> {
  const payload = JSON.stringify(images);
  return page.evaluate(`
    (async () => {
      const images = ${payload};

      // Prefer image/* file inputs; fall back to the first available input.
      const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
      const input = inputs.find(el => {
        const accept = el.getAttribute('accept') || '';
        return accept.includes('image') || accept.includes('.jpg') || accept.includes('.png');
      }) || inputs[0];

      if (!input) return { ok: false, count: 0, error: 'No file input found on page' };

      const dt = new DataTransfer();
      for (const img of images) {
        try {
          const binary = atob(img.base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          const blob = new Blob([bytes], { type: img.mimeType });
          dt.items.add(new File([blob], img.name, { type: img.mimeType }));
        } catch (e) {
          return { ok: false, count: 0, error: 'Failed to create File: ' + e.message };
        }
      }

      Object.defineProperty(input, 'files', { value: dt.files, writable: false });
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new Event('input', { bubbles: true }));

      return { ok: true, count: dt.files.length };
    })()
  `);
}

/**
 * Wait until all upload progress indicators have disappeared (up to maxWaitMs).
 */
async function waitForUploads(page: IPage, maxWaitMs = 30_000): Promise<void> {
  const pollMs = 2_000;
  const maxAttempts = Math.ceil(maxWaitMs / pollMs);
  for (let i = 0; i < maxAttempts; i++) {
    const uploading: boolean = await page.evaluate(`
      () => !!document.querySelector(
        '[class*="upload"][class*="progress"], [class*="uploading"], [class*="loading"][class*="image"]'
      )
    `);
    if (!uploading) return;
    await page.wait(pollMs / 1_000);
  }
}

/**
 * Fill a visible text input or contenteditable with the given text.
 * Tries multiple selectors in priority order.
 * Returns { ok, sel }.
 */
async function fillField(page: IPage, selectors: string[], text: string, fieldName: string): Promise<void> {
  const result: { ok: boolean; sel?: string } = await page.evaluate(`
    (function(selectors, text) {
      for (const sel of selectors) {
        const candidates = document.querySelectorAll(sel);
        for (const el of candidates) {
          if (!el || el.offsetParent === null) continue;
          el.focus();
          if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
            el.value = '';
            document.execCommand('selectAll', false);
            document.execCommand('insertText', false, text);
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          } else {
            // contenteditable
            el.textContent = '';
            document.execCommand('selectAll', false);
            document.execCommand('insertText', false, text);
            el.dispatchEvent(new Event('input', { bubbles: true }));
          }
          return { ok: true, sel };
        }
      }
      return { ok: false };
    })(${JSON.stringify(selectors)}, ${JSON.stringify(text)})
  `);
  if (!result.ok) {
    await page.screenshot({ path: `/tmp/xhs_publish_${fieldName}_debug.png` });
    throw new Error(
      `Could not find ${fieldName} input. Debug screenshot: /tmp/xhs_publish_${fieldName}_debug.png`
    );
  }
}

cli({
  site: 'xiaohongshu',
  name: 'publish',
  description: '小红书发布图文笔记 (creator center UI automation)',
  domain: 'creator.xiaohongshu.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'title', required: true, help: '笔记标题 (最多20字)' },
    { name: 'content', required: true, positional: true, help: '笔记正文' },
    { name: 'images', required: false, help: '图片路径，逗号分隔，最多9张 (jpg/png/gif/webp)' },
    { name: 'topics', required: false, help: '话题标签，逗号分隔，不含 # 号' },
    { name: 'draft', type: 'bool', default: false, help: '保存为草稿，不直接发布' },
  ],
  columns: ['status', 'detail'],
  func: async (page, kwargs) => {

    const title = String(kwargs.title ?? '').trim();
    const content = String(kwargs.content ?? '').trim();
    const imagePaths: string[] = kwargs.images
      ? String(kwargs.images).split(',').map((s: string) => s.trim()).filter(Boolean)
      : [];
    const topics: string[] = kwargs.topics
      ? String(kwargs.topics).split(',').map((s: string) => s.trim()).filter(Boolean)
      : [];
    const isDraft = Boolean(kwargs.draft);

    // ── Validate inputs ────────────────────────────────────────────────────────
    if (!title) throw new Error('--title is required');
    if (title.length > MAX_TITLE_LEN)
      throw new Error(`Title is ${title.length} chars — must be ≤ ${MAX_TITLE_LEN}`);
    if (!content) throw new Error('Positional argument <content> is required');
    if (imagePaths.length > MAX_IMAGES)
      throw new Error(`Too many images: ${imagePaths.length} (max ${MAX_IMAGES})`);

    // Read images in Node.js context before navigating (fast-fail on bad paths)
    const imageData: ImagePayload[] = imagePaths.map(readImageFile);

    // ── Step 1: Navigate to publish page ──────────────────────────────────────
    await page.goto(PUBLISH_URL);
    await page.wait(3);

    // Verify we landed on the creator site (not redirected to login)
    const pageUrl: string = await page.evaluate('() => location.href');
    if (!pageUrl.includes('creator.xiaohongshu.com')) {
      throw new Error(
        'Redirected away from creator center — session may have expired. ' +
        'Re-capture browser login via: opencli xiaohongshu creator-profile'
      );
    }

    // ── Step 2: Select 图文 (image+text) note type if tabs are present ─────────
    const tabClicked: boolean = await page.evaluate(`
      () => {
        const allEls = document.querySelectorAll('[class*="tab"], [class*="note-type"], [class*="type-item"]');
        for (const el of allEls) {
          const text = el.innerText || el.textContent || '';
          if ((text.includes('图文') || text.includes('图片')) && el.offsetParent !== null) {
            el.click();
            return true;
          }
        }
        return false;
      }
    `);
    if (tabClicked) await page.wait(1);

    // ── Step 3: Upload images ──────────────────────────────────────────────────
    if (imageData.length > 0) {
      const upload = await injectImages(page, imageData);
      if (!upload.ok) {
        await page.screenshot({ path: '/tmp/xhs_publish_upload_debug.png' });
        throw new Error(
          `Image injection failed: ${upload.error ?? 'unknown'}. ` +
          'Debug screenshot: /tmp/xhs_publish_upload_debug.png'
        );
      }
      // Allow XHS to process and upload images to its CDN
      await page.wait(UPLOAD_SETTLE_MS / 1_000);
      await waitForUploads(page);
    }

    // ── Step 4: Fill title ─────────────────────────────────────────────────────
    await fillField(
      page,
      [
        'input[maxlength="20"]',
        'input[class*="title"]',
        'input[placeholder*="标题"]',
        'input[placeholder*="title" i]',
        '.title-input input',
        '.note-title input',
        'input[maxlength]',
      ],
      title,
      'title'
    );
    await page.wait(0.5);

    // ── Step 5: Fill content / body ────────────────────────────────────────────
    await fillField(
      page,
      [
        '[contenteditable="true"][class*="content"]',
        '[contenteditable="true"][class*="editor"]',
        '[contenteditable="true"][placeholder*="描述"]',
        '[contenteditable="true"][placeholder*="正文"]',
        '[contenteditable="true"][placeholder*="内容"]',
        '.note-content [contenteditable="true"]',
        '.editor-content [contenteditable="true"]',
        // Broad fallback — last resort; filter out any title contenteditable
        '[contenteditable="true"]:not([placeholder*="标题"]):not([placeholder*="title" i])',
      ],
      content,
      'content'
    );
    await page.wait(0.5);

    // ── Step 6: Add topic hashtags ─────────────────────────────────────────────
    for (const topic of topics) {
      // Click the "添加话题" button
      const btnClicked: boolean = await page.evaluate(`
        () => {
          // Target leaf text nodes that match topic-add labels
          const selectors = 'span, a, button, div, p, [role="button"]';
          for (const el of document.querySelectorAll(selectors)) {
            const text = (el.innerText || el.textContent || '').trim();
            if (
              (text === '添加话题' || text === '# 话题' || text.startsWith('添加话题')) &&
              el.offsetParent !== null &&
              el.children.length === 0
            ) {
              el.click();
              return true;
            }
          }
          // fallback: look for a hashtag icon button
          const hashBtn = document.querySelector('[class*="topic"][class*="btn"], [class*="hashtag"][class*="btn"]');
          if (hashBtn) { hashBtn.click(); return true; }
          return false;
        }
      `);

      if (!btnClicked) continue; // Skip topic if UI not found — non-fatal
      await page.wait(1);

      // Type into the topic search input
      const typed: boolean = await page.evaluate(`
        (topicName => {
          const input = document.querySelector(
            '[class*="topic"] input, [class*="hashtag"] input, input[placeholder*="搜索话题"]'
          );
          if (!input || input.offsetParent === null) return false;
          input.focus();
          document.execCommand('insertText', false, topicName);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        })(${JSON.stringify(topic)})
      `);

      if (!typed) continue;
      await page.wait(1.5); // Wait for autocomplete suggestions

      // Click the first suggestion
      await page.evaluate(`
        () => {
          const item = document.querySelector(
            '[class*="topic-item"], [class*="hashtag-item"], [class*="suggest-item"], [class*="suggestion"] li'
          );
          if (item) item.click();
        }
      `);
      await page.wait(0.5);
    }

    // ── Step 7: Publish or save draft ─────────────────────────────────────────
    const actionLabel = isDraft ? '存草稿' : '发布';
    const btnClicked: boolean = await page.evaluate(`
      (label => {
        const buttons = document.querySelectorAll('button, [role="button"]');
        for (const btn of buttons) {
          const text = (btn.innerText || btn.textContent || '').trim();
          if (
            (text === label || text.includes(label) || text === '发布笔记') &&
            btn.offsetParent !== null &&
            !btn.disabled
          ) {
            btn.click();
            return true;
          }
        }
        return false;
      })(${JSON.stringify(actionLabel)})
    `);

    if (!btnClicked) {
      await page.screenshot({ path: '/tmp/xhs_publish_submit_debug.png' });
      throw new Error(
        `Could not find "${actionLabel}" button. ` +
        'Debug screenshot: /tmp/xhs_publish_submit_debug.png'
      );
    }

    // ── Step 8: Verify success ─────────────────────────────────────────────────
    await page.wait(4);

    const finalUrl: string = await page.evaluate('() => location.href');
    const successMsg: string = await page.evaluate(`
      () => {
        // Check toast / alert containers and common leaf elements for success text
        const selectors = '[class*="toast"], [class*="message"], [class*="alert"], [class*="notice"], [class*="success"], span, p, div';
        for (const el of document.querySelectorAll(selectors)) {
          const text = (el.innerText || '').trim();
          if (
            el.children.length === 0 &&
            (text.includes('发布成功') || text.includes('草稿已保存') || text.includes('上传成功'))
          ) return text;
        }
        return '';
      }
    `);

    const navigatedAway = !finalUrl.includes('/publish/publish');
    const isSuccess = successMsg.length > 0 || navigatedAway;
    const verb = isDraft ? '草稿已保存' : '发布成功';

    return [
      {
        status: isSuccess ? `✅ ${verb}` : '⚠️ 操作完成，请在浏览器中确认',
        detail: [
          `"${title}"`,
          imageData.length ? `${imageData.length}张图片` : '无图',
          topics.length ? `话题: ${topics.join(' ')}` : '',
          successMsg || finalUrl || '',
        ]
          .filter(Boolean)
          .join(' · '),
      },
    ];
  },
});
