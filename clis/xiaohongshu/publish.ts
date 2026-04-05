/**
 * Xiaohongshu 图文笔记 publisher — creator center UI automation.
 *
 * Flow:
 *   1. Navigate to creator publish page
 *   2. Upload images via CDP DOM.setFileInputFiles (with base64 fallback)
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

import { cli, Strategy } from '@jackwener/opencli/registry';
import type { IPage } from '@jackwener/opencli/types';

const PUBLISH_URL = 'https://creator.xiaohongshu.com/publish/publish?from=menu_left';
const MAX_IMAGES = 9;
const MAX_TITLE_LEN = 20;
const UPLOAD_SETTLE_MS = 3000;

/** Selectors for the title field, ordered by priority (new UI first). */
const TITLE_SELECTORS = [
  // New creator center (2026-03) uses contenteditable for the title field.
  // Placeholder observed: "填写标题会有更多赞哦"
  '[contenteditable="true"][placeholder*="标题"]',
  '[contenteditable="true"][placeholder*="赞"]',
  '[contenteditable="true"][class*="title"]',
  'input[maxlength="20"]',
  'input[class*="title"]',
  'input[placeholder*="标题"]',
  'input[placeholder*="title" i]',
  '.title-input input',
  '.note-title input',
  'input[maxlength]',
];

const SUPPORTED_EXTENSIONS: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

/**
 * Validate image paths: check existence and extension.
 * Returns resolved absolute paths.
 */
function validateImagePaths(filePaths: string[]): string[] {
  return filePaths.map((filePath) => {
    const absPath = path.resolve(filePath);
    if (!fs.existsSync(absPath)) throw new Error(`Image file not found: ${absPath}`);
    const ext = path.extname(absPath).toLowerCase();
    if (!SUPPORTED_EXTENSIONS[ext]) {
      throw new Error(`Unsupported image format "${ext}". Supported: jpg, png, gif, webp`);
    }
    return absPath;
  });
}

/** CSS selector for image-accepting file inputs. */
const IMAGE_INPUT_SELECTOR = 'input[type="file"][accept*="image"],'
  + 'input[type="file"][accept*=".jpg"],'
  + 'input[type="file"][accept*=".jpeg"],'
  + 'input[type="file"][accept*=".png"],'
  + 'input[type="file"][accept*=".gif"],'
  + 'input[type="file"][accept*=".webp"]';

/**
 * Upload images via CDP DOM.setFileInputFiles — Chrome reads files directly
 * from the local filesystem, avoiding base64 payload size limits.
 *
 * Falls back to the legacy base64 DataTransfer approach if the extension
 * does not support set-file-input (e.g. older extension version).
 */
async function uploadImages(
  page: IPage,
  absPaths: string[],
): Promise<{ ok: boolean; count: number; error?: string }> {
  // ── Primary: CDP DOM.setFileInputFiles ──────────────────────────────
  if (page.setFileInput) {
    try {
      // Find image-accepting file input on the page
      const selector: string | null = await page.evaluate(`
        (() => {
          const sels = ${JSON.stringify(IMAGE_INPUT_SELECTOR)};
          const el = document.querySelector(sels);
          return el ? sels : null;
        })()
      `);
      if (!selector) {
        return { ok: false, count: 0, error: 'No file input found on page' };
      }
      await page.setFileInput(absPaths, selector);
      return { ok: true, count: absPaths.length };
    } catch (err) {
      // If set-file-input action is not supported by extension, fall through to legacy
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Unknown action') || msg.includes('not supported')) {
        // Extension too old — fall through to legacy base64 method
      } else {
        return { ok: false, count: 0, error: msg };
      }
    }
  }

  // ── Fallback: legacy base64 DataTransfer injection ─────────────────
  const images = absPaths.map((absPath) => {
    const base64 = fs.readFileSync(absPath).toString('base64');
    const ext = path.extname(absPath).toLowerCase();
    return { name: path.basename(absPath), mimeType: SUPPORTED_EXTENSIONS[ext], base64 };
  });

  // Warn if total payload is large — this may fail with older extensions
  const totalBytes = images.reduce((sum, img) => sum + img.base64.length, 0);
  if (totalBytes > 500_000) {
    console.warn(
      `[warn] Total image payload is ${(totalBytes / 1024 / 1024).toFixed(1)}MB (base64). ` +
      'This may fail with the browser bridge. Update the extension to v1.6+ for CDP-based upload, ' +
      'or compress images before publishing.'
    );
  }

  const payload = JSON.stringify(images);
  return page.evaluate(`
    (async () => {
      const images = ${payload};

      const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
      const input = inputs.find(el => {
        const accept = el.getAttribute('accept') || '';
        return (
          accept.includes('image') ||
          accept.includes('.jpg') ||
          accept.includes('.jpeg') ||
          accept.includes('.png') ||
          accept.includes('.gif') ||
          accept.includes('.webp')
        );
      });

      if (!input) return { ok: false, count: 0, error: 'No image file input found on page' };

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
    await page.wait({ time: pollMs / 1_000 });
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

async function selectImageTextTab(
  page: IPage,
): Promise<{ ok: boolean; target?: string; text?: string; visibleTexts?: string[] }> {
  const result = await page.evaluate(`
    () => {
      const isVisible = (el) => {
        if (!el || el.offsetParent === null) return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
      const selector = 'button, [role="tab"], [role="button"], a, label, div, span, li';
      const nodes = Array.from(document.querySelectorAll(selector));
      const targets = ['上传图文', '图文', '图片'];

      for (const target of targets) {
        for (const node of nodes) {
          if (!isVisible(node)) continue;
          const text = normalize(node.innerText || node.textContent || '');
          if (!text || text.includes('视频')) continue;
          if (text === target || text.startsWith(target) || text.includes(target)) {
            const clickable = node.closest('button, [role="tab"], [role="button"], a, label') || node;
            clickable.click();
            return { ok: true, target, text };
          }
        }
      }

      const visibleTexts = [];
      for (const node of nodes) {
        if (!isVisible(node)) continue;
        const text = normalize(node.innerText || node.textContent || '');
        if (!text || text.length > 20) continue;
        visibleTexts.push(text);
        if (visibleTexts.length >= 20) break;
      }
      return { ok: false, visibleTexts };
    }
  `);
  if (result?.ok) {
    await page.wait({ time: 1 });
  }
  return result;
}

type PublishSurfaceState = 'video_surface' | 'image_surface' | 'editor_ready';

type PublishSurfaceInspection = {
  state: PublishSurfaceState;
  hasTitleInput: boolean;
  hasImageInput: boolean;
  hasVideoSurface: boolean;
};

async function inspectPublishSurfaceState(page: IPage): Promise<PublishSurfaceInspection> {
  return page.evaluate(`
    () => {
      const text = (document.body?.innerText || '').replace(/\s+/g, ' ').trim();
      const hasTitleInput = !!Array.from(document.querySelectorAll('input, textarea')).find((el) => {
        if (!el || el.offsetParent === null) return false;
        const placeholder = (el.getAttribute('placeholder') || '').trim();
        const cls = el.className ? String(el.className) : '';
        const maxLength = Number(el.getAttribute('maxlength') || 0);
        return (
          placeholder.includes('标题') ||
          /title/i.test(placeholder) ||
          /title/i.test(cls) ||
          maxLength === 20
        );
      });
      const hasImageInput = !!Array.from(document.querySelectorAll('input[type="file"]')).find((el) => {
        const accept = el.getAttribute('accept') || '';
        return (
          accept.includes('image') ||
          accept.includes('.jpg') ||
          accept.includes('.jpeg') ||
          accept.includes('.png') ||
          accept.includes('.gif') ||
          accept.includes('.webp')
        );
      });
      const hasVideoSurface = text.includes('拖拽视频到此处点击上传') || text.includes('上传视频');
      const state = hasTitleInput ? 'editor_ready' : hasImageInput || !hasVideoSurface ? 'image_surface' : 'video_surface';
      return { state, hasTitleInput, hasImageInput, hasVideoSurface };
    }
  `);
}

async function waitForPublishSurfaceState(
  page: IPage,
  maxWaitMs = 5_000,
): Promise<PublishSurfaceInspection> {
  const pollMs = 500;
  const maxAttempts = Math.max(1, Math.ceil(maxWaitMs / pollMs));
  let surface = await inspectPublishSurfaceState(page);

  for (let i = 0; i < maxAttempts; i++) {
    if (surface.state !== 'video_surface') {
      return surface;
    }
    if (i < maxAttempts - 1) {
      await page.wait({ time: pollMs / 1_000 });
      surface = await inspectPublishSurfaceState(page);
    }
  }

  return surface;
}

/**
 * Poll until the title/content editing form appears on the page.
 * The new creator center UI only renders the editor after images are uploaded.
 */
async function waitForEditForm(page: IPage, maxWaitMs = 10_000): Promise<boolean> {
  const pollMs = 1_000;
  const maxAttempts = Math.ceil(maxWaitMs / pollMs);
  for (let i = 0; i < maxAttempts; i++) {
    const found: boolean = await page.evaluate(`
      (() => {
        const sels = ${JSON.stringify(TITLE_SELECTORS)};
        for (const sel of sels) {
          const el = document.querySelector(sel);
          if (el && el.offsetParent !== null) return true;
        }
        return false;
      })()`);
    if (found) return true;
    if (i < maxAttempts - 1) await page.wait({ time: pollMs / 1_000 });
  }
  return false;
}

cli({
  site: 'xiaohongshu',
  name: 'publish',
  description: '小红书发布图文笔记 (creator center UI automation)',
  domain: 'creator.xiaohongshu.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'title', required: true, help: '笔记标题 (最多20字)' },
    { name: 'content', required: true, positional: true, help: '笔记正文' },
    { name: 'images', required: true, help: '图片路径，逗号分隔，最多9张 (jpg/png/gif/webp)' },
    { name: 'topics', required: false, help: '话题标签，逗号分隔，不含 # 号' },
    { name: 'draft', type: 'bool', default: false, help: '保存为草稿，不直接发布' },
  ],
  columns: ['status', 'detail'],
  func: async (page: IPage | null, kwargs) => {
    if (!page) throw new Error('Browser page required');

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
    if (imagePaths.length === 0)
      throw new Error('At least one --images path is required. The creator center now requires images before showing the editor.');
    if (imagePaths.length > MAX_IMAGES)
      throw new Error(`Too many images: ${imagePaths.length} (max ${MAX_IMAGES})`);

    // Validate image paths before navigating (fast-fail on bad paths / unsupported formats)
    const absImagePaths = validateImagePaths(imagePaths);

    // ── Step 1: Navigate to publish page ──────────────────────────────────────
    await page.goto(PUBLISH_URL);
    await page.wait({ time: 3 });

    // Verify we landed on the creator site (not redirected to login)
    const pageUrl: string = await page.evaluate('() => location.href');
    if (!pageUrl.includes('creator.xiaohongshu.com')) {
      throw new Error(
        'Redirected away from creator center — session may have expired. ' +
        'Re-capture browser login via: opencli xiaohongshu creator-profile'
      );
    }

    // ── Step 2: Select 图文 (image+text) note type if tabs are present ─────────
    const tabResult = await selectImageTextTab(page);
    const surface = await waitForPublishSurfaceState(page, tabResult?.ok ? 5_000 : 2_000);
    if (surface.state === 'video_surface') {
      await page.screenshot({ path: '/tmp/xhs_publish_tab_debug.png' });
      const detail = tabResult?.ok
        ? `clicked "${tabResult.text}"`
        : `visible candidates: ${(tabResult?.visibleTexts || []).join(' | ') || 'none'}`;
      throw new Error(
        'Still on the video publish page after trying to select 图文. ' +
        `Details: ${detail}. Debug screenshot: /tmp/xhs_publish_tab_debug.png`
      );
    }

    // ── Step 3: Upload images ──────────────────────────────────────────────────
    const upload = await uploadImages(page, absImagePaths);
    if (!upload.ok) {
      await page.screenshot({ path: '/tmp/xhs_publish_upload_debug.png' });
      throw new Error(
        `Image injection failed: ${upload.error ?? 'unknown'}. ` +
        'Debug screenshot: /tmp/xhs_publish_upload_debug.png'
      );
    }
    // Allow XHS to process and upload images to its CDN
    await page.wait({ time: UPLOAD_SETTLE_MS / 1_000 });
    await waitForUploads(page);

    // ── Step 3b: Wait for editor form to render ───────────────────────────────
    const formReady = await waitForEditForm(page);
    if (!formReady) {
      await page.screenshot({ path: '/tmp/xhs_publish_form_debug.png' });
      throw new Error(
        'Editing form did not appear after image upload. The page layout may have changed. ' +
        'Debug screenshot: /tmp/xhs_publish_form_debug.png'
      );
    }

    // ── Step 4: Fill title ─────────────────────────────────────────────────────
    await fillField(page, TITLE_SELECTORS, title, 'title');
    await page.wait({ time: 0.5 });

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
        '[contenteditable="true"]:not([placeholder*="标题"]):not([placeholder*="赞"]):not([placeholder*="title" i])',
      ],
      content,
      'content'
    );
    await page.wait({ time: 0.5 });

    // ── Step 6: Add topic hashtags ─────────────────────────────────────────────
    for (const topic of topics) {
      // Click the "添加话题" button
      const btnClicked: boolean = await page.evaluate(`
        () => {
          const candidates = document.querySelectorAll('*');
          for (const el of candidates) {
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
      await page.wait({ time: 1 });

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
      await page.wait({ time: 1.5 }); // Wait for autocomplete suggestions

      // Click the first suggestion
      await page.evaluate(`
        () => {
          const item = document.querySelector(
            '[class*="topic-item"], [class*="hashtag-item"], [class*="suggest-item"], [class*="suggestion"] li'
          );
          if (item) item.click();
        }
      `);
      await page.wait({ time: 0.5 });
    }

    // ── Step 7: Publish or save draft ─────────────────────────────────────────
    const actionLabels = isDraft ? ['暂存离开', '存草稿'] : ['发布', '发布笔记'];
    const btnClicked: boolean = await page.evaluate(`
      (labels => {
        const buttons = document.querySelectorAll('button, [role="button"]');
        for (const btn of buttons) {
          const text = (btn.innerText || btn.textContent || '').trim();
          if (
            labels.some(l => text === l || text.includes(l)) &&
            btn.offsetParent !== null &&
            !btn.disabled
          ) {
            btn.click();
            return true;
          }
        }
        return false;
      })(${JSON.stringify(actionLabels)})
    `);

    if (!btnClicked) {
      await page.screenshot({ path: '/tmp/xhs_publish_submit_debug.png' });
      throw new Error(
        `Could not find "${actionLabels[0]}" button. ` +
        'Debug screenshot: /tmp/xhs_publish_submit_debug.png'
      );
    }

    // ── Step 8: Verify success ─────────────────────────────────────────────────
    await page.wait({ time: 4 });

    const finalUrl: string = await page.evaluate('() => location.href');
    const successMsg: string = await page.evaluate(`
      () => {
        for (const el of document.querySelectorAll('*')) {
          const text = (el.innerText || '').trim();
          if (
            el.children.length === 0 &&
            (text.includes('发布成功') || text.includes('草稿已保存') || text.includes('暂存成功') || text.includes('上传成功'))
          ) return text;
        }
        return '';
      }
    `);

    const navigatedAway = !finalUrl.includes('/publish/publish');
    const isSuccess = successMsg.length > 0 || navigatedAway;
    const verb = isDraft ? '暂存成功' : '发布成功';

    return [
      {
        status: isSuccess ? `✅ ${verb}` : '⚠️ 操作完成，请在浏览器中确认',
        detail: [
          `"${title}"`,
          `${absImagePaths.length}张图片`,
          topics.length ? `话题: ${topics.join(' ')}` : '',
          successMsg || finalUrl || '',
        ]
          .filter(Boolean)
          .join(' · '),
      },
    ];
  },
});
