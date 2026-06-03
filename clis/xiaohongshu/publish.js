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
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
const PUBLISH_URL = 'https://creator.xiaohongshu.com/publish/publish?from=menu_left&target=image';
const MAX_IMAGES = 9;
const MAX_TITLE_LEN = 20;
const UPLOAD_SETTLE_MS = 3000;
/**
 * XHS creator center wraps the publish/save button in an `<xhs-publish-btn>`
 * web component backed by a CLOSED shadow root. Host-level `.click()` does
 * not dispatch into the internal handler. Invoke these instance methods on
 * the host element to trigger publish / save-draft directly (#1606).
 */
const PUBLISH_METHOD_NAMES = ['_onPublish', 'onPublish', '_onSubmit', '_handlePublish'];
const DRAFT_METHOD_NAMES = ['_onSave', '_onSaveDraft', '_onDraft'];
/** Selectors for the title field, ordered by priority across current UI variants. */
const TITLE_SELECTORS = [
    // Some creator-center variants expose the title as contenteditable,
    // others use a normal <input> with the same placeholder. Visible
    // user-facing variants always carry a Chinese placeholder; class-based
    // variants also match a pair of 4 px wide hidden scaffolding inputs
    // (same `class*="title"`, empty placeholder, no v-model commit on save)
    // so placeholder-based selectors take precedence to avoid filling those.
    '[contenteditable="true"][placeholder*="标题"]',
    '[contenteditable="true"][placeholder*="赞"]',
    'input[placeholder*="标题"]',
    'input[placeholder*="title" i]',
    '[contenteditable="true"][class*="title"]',
    'input[maxlength="20"]',
    'input[class*="title"]',
    '.title-input input',
    '.note-title input',
    'input[maxlength]',
];
/** Selectors for the note body / content editor, ordered by priority. */
const BODY_SELECTORS = [
    '[contenteditable="true"][class*="content"]',
    '[contenteditable="true"][class*="editor"]',
    '[contenteditable="true"][placeholder*="描述"]',
    '[contenteditable="true"][placeholder*="正文"]',
    '[contenteditable="true"][placeholder*="内容"]',
    '.note-content [contenteditable="true"]',
    '.editor-content [contenteditable="true"]',
    // Broad fallback — last resort; filter out any title contenteditable
    '[contenteditable="true"]:not([placeholder*="标题"]):not([placeholder*="赞"]):not([placeholder*="title" i])',
];
const SUPPORTED_EXTENSIONS = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
};
function unwrapBrowserResult(value) {
    if (
        value
        && typeof value === 'object'
        && typeof value.session === 'string'
        && Object.prototype.hasOwnProperty.call(value, 'data')
    ) {
        return value.data;
    }
    return value;
}
/**
 * Validate image paths: check existence and extension.
 * Returns resolved absolute paths.
 */
function validateImagePaths(filePaths) {
    return filePaths.map((filePath) => {
        const absPath = path.resolve(filePath);
        if (!fs.existsSync(absPath))
            throw new Error(`Image file not found: ${absPath}`);
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
async function uploadImages(page, absPaths) {
    // ── Primary: CDP DOM.setFileInputFiles ──────────────────────────────
    if (page.setFileInput) {
        try {
            // Find image-accepting file input on the page
            const selector = await page.evaluate(`
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
        }
        catch (err) {
            // If set-file-input action is not supported by extension, fall through to legacy
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes('Unknown action') || msg.includes('not supported') || msg.includes('Not allowed')) {
                // Extension too old — fall through to legacy base64 method
            }
            else {
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
        console.warn(`[warn] Total image payload is ${(totalBytes / 1024 / 1024).toFixed(1)}MB (base64). ` +
            'This may fail with the browser bridge. Update the extension to v1.6+ for CDP-based upload, ' +
            'or compress images before publishing.');
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
async function waitForUploads(page, maxWaitMs = 30_000) {
    const pollMs = 2_000;
    const maxAttempts = Math.ceil(maxWaitMs / pollMs);
    for (let i = 0; i < maxAttempts; i++) {
        const uploading = await page.evaluate(`
      () => !!document.querySelector(
        '[class*="upload"][class*="progress"], [class*="uploading"], [class*="loading"][class*="image"]'
      )
    `);
        if (!uploading)
            return;
        await page.wait({ time: pollMs / 1_000 });
    }
}
/**
 * Fill a visible text input or contenteditable with the given text.
 * Tries multiple selectors in priority order.
 * Returns { ok, sel }.
 */
async function fillField(page, selectors, text, fieldName) {
    const located = await page.evaluate(`
    (function(selectors) {
      const __opencli_xhs_fill_phase = "locate";
      for (const sel of selectors) {
        const candidates = document.querySelectorAll(sel);
        for (const el of candidates) {
          if (!el || el.offsetParent === null) continue;
          const kind = el.isContentEditable
            ? 'contenteditable'
            : (el.tagName === 'TEXTAREA' ? 'textarea' : 'input');
          return { ok: true, sel, kind };
        }
      }
      return { ok: false };
    })(${JSON.stringify(selectors)})
  `);
    if (!located.ok) {
        await page.screenshot({ path: `/tmp/xhs_publish_${fieldName}_debug.png` });
        throw new Error(`Could not find ${fieldName} input. Debug screenshot: /tmp/xhs_publish_${fieldName}_debug.png`);
    }
    const applyInPage = () => page.evaluate(`
      ((selector, expectedText) => {
        const __opencli_xhs_fill_phase = "apply";
        const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
        const fireBeforeInput = (el, value) => {
          try {
            el.dispatchEvent(new InputEvent('beforeinput', {
              bubbles: true,
              data: value,
              inputType: 'insertText',
            }));
          } catch {
            el.dispatchEvent(new Event('beforeinput', { bubbles: true }));
          }
        };
        const fireInput = (el, value) => {
          try {
            el.dispatchEvent(new InputEvent('input', {
              bubbles: true,
              data: value,
              inputType: 'insertText',
            }));
          } catch {
            el.dispatchEvent(new Event('input', { bubbles: true }));
          }
        };
        const el = Array.from(document.querySelectorAll(selector)).find(node => node && node.offsetParent !== null);
        if (!el) return { ok: false, actual: '' };
        el.focus();
        fireBeforeInput(el, expectedText);
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
          const proto = el.tagName === 'TEXTAREA'
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
          const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
          if (nativeSetter) nativeSetter.call(el, expectedText);
          else el.value = expectedText;
          fireInput(el, expectedText);
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.blur();
          return { ok: el.value === expectedText, actual: el.value || '' };
        }
        el.textContent = '';
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        selection?.removeAllRanges();
        selection?.addRange(range);
        const inserted = document.execCommand('insertText', false, expectedText);
        if (!inserted) el.textContent = expectedText;
        fireInput(el, expectedText);
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.blur();
        const actual = normalize(el.innerText || el.textContent || '');
        return { ok: actual === normalize(expectedText), actual };
      })(${JSON.stringify(located.sel)}, ${JSON.stringify(text)})
    `);
    let result;
    if (located.kind === 'contenteditable' && page.insertText) {
        const prepared = await page.evaluate(`
      ((selector, nextText) => {
        const __opencli_xhs_fill_phase = "prepare";
        const fireBeforeInput = (el, value) => {
          try {
            el.dispatchEvent(new InputEvent('beforeinput', {
              bubbles: true,
              data: value,
              inputType: 'insertText',
            }));
          } catch {
            el.dispatchEvent(new Event('beforeinput', { bubbles: true }));
          }
        };
        const el = Array.from(document.querySelectorAll(selector)).find(node => node && node.offsetParent !== null);
        if (!el) return { ok: false };
        el.focus();
        el.textContent = '';
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        selection?.removeAllRanges();
        selection?.addRange(range);
        fireBeforeInput(el, nextText);
        return { ok: true };
      })(${JSON.stringify(located.sel)}, ${JSON.stringify(text)})
    `);
        if (!prepared?.ok) {
            await page.screenshot({ path: `/tmp/xhs_publish_${fieldName}_debug.png` });
            throw new Error(`Could not prepare ${fieldName} input. Debug screenshot: /tmp/xhs_publish_${fieldName}_debug.png`);
        }
        try {
            await page.insertText(text);
            result = await page.evaluate(`
      ((selector, expectedText) => {
        const __opencli_xhs_fill_phase = "verify";
        const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
        const fireInput = (el, value) => {
          try {
            el.dispatchEvent(new InputEvent('input', {
              bubbles: true,
              data: value,
              inputType: 'insertText',
            }));
          } catch {
            el.dispatchEvent(new Event('input', { bubbles: true }));
          }
        };
        const el = Array.from(document.querySelectorAll(selector)).find(node => node && node.offsetParent !== null);
        if (!el) return { ok: false, actual: '' };
        fireInput(el, expectedText);
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.blur();
        const actual = normalize(el.innerText || el.textContent || '');
        return { ok: actual === normalize(expectedText), actual };
      })(${JSON.stringify(located.sel)}, ${JSON.stringify(text)})
    `);
        }
        catch {
            result = await applyInPage();
        }
    }
    else {
        result = await applyInPage();
    }
    if (!result?.ok) {
        await page.screenshot({ path: `/tmp/xhs_publish_${fieldName}_debug.png` });
        const actual = typeof result?.actual === 'string' ? result.actual : '';
        throw new Error(`Failed to set ${fieldName}. Expected "${text}", got "${actual}". Debug screenshot: /tmp/xhs_publish_${fieldName}_debug.png`);
    }
}
/**
 * Add topic hashtags by driving the editor's native inline "#" flow.
 *
 * Modern XHS creator-center editors turn a "#keyword" typed into the note body
 * into a linked topic entity only after the author picks an item from the
 * suggestion dropdown that appears while typing. There is no standalone
 * "添加话题" search input anymore, so we type directly into the body editor.
 *
 * For each topic we:
 *   1. focus the body contenteditable and move the caret to the end,
 *   2. type " #<topic>" using native CDP insertion (falls back to execCommand)
 *      so XHS fires its inline suggestion dropdown,
 *   3. wait for the dropdown, then click the suggestion whose text best matches
 *      the topic (falling back to the first suggestion, then to Enter),
 *   4. confirm a topic chip/link was produced before moving on.
 *
 * A requested topic is a write-side postcondition: if XHS does not create a
 * real topic entity, fail before publishing instead of silently emitting a note
 * with bare "#text".
 */
async function focusBodyEnd(page, bodySelectors) {
    return unwrapBrowserResult(await page.evaluate(`
    (selectors => {
      const el = selectors
        .map(sel => Array.from(document.querySelectorAll(sel)))
        .flat()
        .find(node => node && node.offsetParent !== null && node.isContentEditable);
      if (!el) return false;
      el.focus();
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(range);
      return true;
    })(${JSON.stringify(bodySelectors)})
  `));
}
function topicSuggestionScript(topic, { click = false } = {}) {
    // Returns the best matching suggestion's screen coordinates (center) so the
    // caller can issue a real click.
    return `
    (topicName => {
      const norm = (value) => (value || '').replace(/^#/, '').replace(/\\s+/g, '').trim();
      const want = norm(topicName);
      const SUGGESTION_SELECTORS = [
        '[class*="topic-item"]',
        '[class*="hashtag-item"]',
        '[class*="suggest-item"]',
        '[class*="suggestion"] li',
        '[class*="mention"] li',
        '[class*="dropdown"] li',
        '[id*="topic"] li',
        '[class*="topic"] li',
      ];
      const seen = new Set();
      const items = [];
      for (const sel of SUGGESTION_SELECTORS) {
        for (const node of document.querySelectorAll(sel)) {
          if (!node || seen.has(node)) continue;
          if (node.offsetParent === null) continue;
          const rect = node.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) continue;
          seen.add(node);
          items.push(node);
        }
      }
      if (!items.length) return { ok: false, count: 0 };
      let target = items.find(node => norm(node.innerText || node.textContent) === want);
      if (!target) target = items.find(node => norm(node.innerText || node.textContent).includes(want));
      if (!target) target = items[0];
      const rect = target.getBoundingClientRect();
      ${click ? "try { target.click(); } catch (e) { return { ok: false, count: items.length, message: String(e) }; }" : ''}
      return {
        ok: true,
        count: items.length,
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2),
        text: (target.innerText || target.textContent || '').trim().slice(0, 40),
      };
    })(${JSON.stringify(topic)})
  `;
}
function topicEntityCountScript(topic, bodySelectors) {
    return `
    ((topicName, selectors) => {
      const norm = (value) => (value || '').replace(/^#/, '').replace(/\\s+/g, '').trim();
      const want = norm(topicName);
      const editor = selectors
        .map(sel => Array.from(document.querySelectorAll(sel)))
        .flat()
        .find(node => node && node.offsetParent !== null && node.isContentEditable);
      if (!editor || !want) return 0;
      const hasTopicSignal = (node) => {
        const tag = (node.tagName || '').toLowerCase();
        const role = (node.getAttribute && node.getAttribute('role')) || '';
        const cls = String(node.className || '');
        const id = String(node.id || '');
        const href = (node.getAttribute && node.getAttribute('href')) || '';
        const dataKeys = node.dataset ? Object.keys(node.dataset).join(' ') : '';
        const haystack = [tag, role, cls, id, href, dataKeys].join(' ');
        return tag === 'a'
          || /link/i.test(role)
          || /topic|hashtag|hash-tag|tag|mention|keyword/i.test(haystack)
          || node.isContentEditable === false;
      };
      let count = 0;
      for (const node of Array.from(editor.querySelectorAll('*'))) {
        if (!node || node.offsetParent === null) continue;
        if (!hasTopicSignal(node)) continue;
        const text = norm(node.innerText || node.textContent || '');
        if (text === want || text === '#' + want) count += 1;
      }
      return count;
    })(${JSON.stringify(topic)}, ${JSON.stringify(bodySelectors)})
  `;
}
async function typeTopicQuery(page, topic) {
    // Type "#<topic>" so XHS recognizes it as a topic query and pops the inline
    // suggestion dropdown. The caller separates topics with Enter beforehand so
    // each query starts on its own line and matches cleanly.
    const query = `#${topic}`;
    if (typeof page.insertText === 'function') {
        try {
            await page.insertText(query);
            return true;
        }
        catch {
            // fall through to execCommand path
        }
    }
    return unwrapBrowserResult(await page.evaluate(`
    (text => {
      const ok = document.execCommand('insertText', false, text);
      const active = document.activeElement;
      if (active) active.dispatchEvent(new Event('input', { bubbles: true }));
      return ok;
    })(${JSON.stringify(query)})
  `));
}
async function addTopics(page, bodySelectors, topics) {
    const added = [];
    for (const topic of topics) {
        const focused = await focusBodyEnd(page, bodySelectors);
        if (!focused) {
            throw new CommandExecutionError(`Could not attach topic "${topic}": body editor not found`);
        }
        const beforeCount = Number(unwrapBrowserResult(await page.evaluate(topicEntityCountScript(topic, bodySelectors)))) || 0;
        // Separate this topic from the preceding text so the dropdown is clean.
        if (typeof page.pressKey === 'function') {
            try {
                await page.pressKey('Enter');
            }
            catch { /* non-fatal */ }
        }
        const typed = await typeTopicQuery(page, topic);
        if (!typed) {
            throw new CommandExecutionError(`Could not attach topic "${topic}": failed to type inline topic query`);
        }
        await page.wait({ time: 1.2 }); // Let the suggestion dropdown render.
        const suggestion = unwrapBrowserResult(await page.evaluate(topicSuggestionScript(topic)));
        if (suggestion?.ok) {
            if (typeof page.nativeClick === 'function'
                && Number.isFinite(suggestion.x)
                && Number.isFinite(suggestion.y)) {
                await page.nativeClick(suggestion.x, suggestion.y);
            }
            else {
                const clicked = unwrapBrowserResult(await page.evaluate(topicSuggestionScript(topic, { click: true })));
                if (!clicked?.ok) {
                    throw new CommandExecutionError(`Could not attach topic "${topic}": failed to click suggestion`);
                }
            }
        }
        else if (typeof page.pressKey === 'function') {
            // No dropdown items found via selectors — fall back to Enter, which
            // accepts the highlighted suggestion in most XHS editor variants.
            await page.pressKey('Enter');
        }
        else {
            throw new CommandExecutionError(`Could not attach topic "${topic}": no suggestion found`);
        }
        await page.wait({ time: 0.8 });
        const afterCount = Number(unwrapBrowserResult(await page.evaluate(topicEntityCountScript(topic, bodySelectors)))) || 0;
        if (afterCount <= beforeCount) {
            throw new CommandExecutionError(`Could not attach topic "${topic}": no real topic entity appeared after selection`);
        }
        added.push(topic);
        await page.wait({ time: 0.4 });
    }
    return added;
}
async function selectImageTextTab(page) {
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
          if (text === target) {
            const clickable = node.closest('button, [role="tab"], [role="button"], a, label') || node;
            clickable.click();
            return { ok: true, target, text };
          }
        }
      }

      for (const target of targets) {
        for (const node of nodes) {
          if (!isVisible(node)) continue;
          const text = normalize(node.innerText || node.textContent || '');
          if (!text || text.includes('视频')) continue;
          if (text.startsWith(target) || text.includes(target)) {
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
async function inspectPublishSurfaceState(page) {
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
async function waitForPublishSurfaceState(page, maxWaitMs = 5_000) {
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
async function waitForEditForm(page, maxWaitMs = 10_000) {
    const pollMs = 1_000;
    const maxAttempts = Math.ceil(maxWaitMs / pollMs);
    for (let i = 0; i < maxAttempts; i++) {
        const found = await page.evaluate(`
      (() => {
        const sels = ${JSON.stringify(TITLE_SELECTORS)};
        for (const sel of sels) {
          const el = document.querySelector(sel);
          if (el && el.offsetParent !== null) return true;
        }
        return false;
      })()`);
        if (found)
            return true;
        if (i < maxAttempts - 1)
            await page.wait({ time: pollMs / 1_000 });
    }
    return false;
}
cli({
    site: 'xiaohongshu',
    name: 'publish',
    access: 'write',
    description: '小红书发布图文笔记 (creator center UI automation)',
    domain: 'creator.xiaohongshu.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'title', required: true, help: '笔记标题 (最多20字)' },
        { name: 'content', required: true, positional: true, help: '笔记正文' },
        { name: 'images', required: true, help: '图片路径，逗号分隔，最多9张 (jpg/png/gif/webp)' },
        { name: 'topics', required: false, help: '话题标签，逗号分隔，不含 # 号' },
        { name: 'draft', type: 'bool', default: false, help: '保存为草稿，不直接发布' },
    ],
    columns: ['status', 'detail'],
    func: async (page, kwargs) => {
        if (!page)
            throw new Error('Browser page required');
        const title = String(kwargs.title ?? '').trim();
        const content = String(kwargs.content ?? '').trim();
        const imagePaths = kwargs.images
            ? String(kwargs.images).split(',').map((s) => s.trim()).filter(Boolean)
            : [];
        const topics = kwargs.topics
            ? String(kwargs.topics).split(',').map((s) => s.trim()).filter(Boolean)
            : [];
        const isDraft = Boolean(kwargs.draft);
        // ── Validate inputs ────────────────────────────────────────────────────────
        if (!title)
            throw new Error('--title is required');
        if (title.length > MAX_TITLE_LEN)
            throw new Error(`Title is ${title.length} chars — must be ≤ ${MAX_TITLE_LEN}`);
        if (!content)
            throw new Error('Positional argument <content> is required');
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
        const pageUrl = await page.evaluate('() => location.href');
        if (!pageUrl.includes('creator.xiaohongshu.com')) {
            throw new Error('Redirected away from creator center — session may have expired. ' +
                'Re-capture browser login via: opencli xiaohongshu creator-profile');
        }
        // ── Step 2: Select 图文 (image+text) note type if tabs are present ─────────
        const tabResult = await selectImageTextTab(page);
        const surface = await waitForPublishSurfaceState(page, tabResult?.ok ? 5_000 : 2_000);
        if (surface.state === 'video_surface') {
            await page.screenshot({ path: '/tmp/xhs_publish_tab_debug.png' });
            const detail = tabResult?.ok
                ? `clicked "${tabResult.text}"`
                : `visible candidates: ${(tabResult?.visibleTexts || []).join(' | ') || 'none'}`;
            throw new Error('Still on the video publish page after trying to select 图文. ' +
                `Details: ${detail}. Debug screenshot: /tmp/xhs_publish_tab_debug.png`);
        }
        // ── Step 3: Upload images ──────────────────────────────────────────────────
        const upload = await uploadImages(page, absImagePaths);
        if (!upload.ok) {
            await page.screenshot({ path: '/tmp/xhs_publish_upload_debug.png' });
            throw new Error(`Image injection failed: ${upload.error ?? 'unknown'}. ` +
                'Debug screenshot: /tmp/xhs_publish_upload_debug.png');
        }
        // Allow XHS to process and upload images to its CDN
        await page.wait({ time: UPLOAD_SETTLE_MS / 1_000 });
        await waitForUploads(page);
        // ── Step 3b: Wait for editor form to render ───────────────────────────────
        const formReady = await waitForEditForm(page);
        if (!formReady) {
            await page.screenshot({ path: '/tmp/xhs_publish_form_debug.png' });
            throw new Error('Editing form did not appear after image upload. The page layout may have changed. ' +
                'Debug screenshot: /tmp/xhs_publish_form_debug.png');
        }
        // ── Step 4: Fill title ─────────────────────────────────────────────────────
        await fillField(page, TITLE_SELECTORS, title, 'title');
        await page.wait({ time: 0.5 });
        // ── Step 5: Fill content / body ────────────────────────────────────────────
        await fillField(page, BODY_SELECTORS, content, 'content');
        await page.wait({ time: 0.5 });
        // ── Step 6: Add topic hashtags ─────────────────────────────────────────────
        // XHS converts a "#keyword" typed into the body editor into a real topic
        // entity only when the user picks an item from the inline suggestion
        // dropdown that pops up while typing. The previous implementation looked
        // for a standalone "添加话题" button + dedicated search <input>, which the
        // current creator-center editor no longer exposes — it left bare "#"
        // characters in the body with no linked topics. We now drive the native
        // inline flow: focus the body editor, type "#keyword" (firing the
        // dropdown), then select the matching suggestion.
        let addedTopics = [];
        if (topics.length) {
            addedTopics = await addTopics(page, BODY_SELECTORS, topics);
        }
        // ── Step 7: Publish or save draft ─────────────────────────────────────────
        const actionLabels = isDraft ? ['暂存离开', '存草稿'] : ['发布', '发布笔记'];
        const invokeResult = await page.evaluate(`
      (cfg => {
        const { isDraftMode, publishNames, draftNames, labels } = cfg;
        const isVisible = (el) => {
          if (!el || el.offsetParent === null) return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        };
        // Path 1: web component method invoke on <xhs-publish-btn>.
        const hosts = Array.from(document.querySelectorAll('xhs-publish-btn')).filter(isVisible);
        const wanted = isDraftMode ? draftNames : publishNames;
        // Try every host + every candidate; do NOT bail on the first throw
        // (multiple hosts can exist, and a later name may succeed).
        let lastMethodError = null;
        for (const host of hosts) {
          for (const name of wanted) {
            if (typeof host[name] !== 'function') continue;
            try {
              host[name]();
              return { ok: true, via: 'method', name };
            } catch (err) {
              lastMethodError = String(err && err.message || err);
            }
          }
        }
        // Path 2: legacy <button>/[role=button] text-match click fallback.
        const buttons = document.querySelectorAll('button, [role="button"]');
        for (const btn of buttons) {
          const text = (btn.innerText || btn.textContent || '').trim();
          if (
            labels.some(l => text === l || text.includes(l)) &&
            isVisible(btn) &&
            !btn.disabled
          ) {
            btn.click();
            return { ok: true, via: 'click', text };
          }
        }
        return { ok: false, via: 'none', hosts: hosts.length, lastMethodError };
      })(${JSON.stringify({
            isDraftMode: isDraft,
            publishNames: PUBLISH_METHOD_NAMES,
            draftNames: DRAFT_METHOD_NAMES,
            labels: actionLabels,
        })})
    `);
        if (!invokeResult?.ok) {
            // ── Draft fallback: try leave-and-save flow ──────────────────────────
            if (isDraft) {
                const leaveTriggered = await page.evaluate(`
              (() => {
                const labels = ['返回', '关闭', '取消', '离开'];
                const buttons = document.querySelectorAll('button, [role="button"], div, span');
                for (const btn of buttons) {
                  const text = (btn.innerText || btn.textContent || '').trim();
                  if (labels.some(l => text === l || text.includes(l)) && btn.offsetParent !== null) {
                    btn.click();
                    return true;
                  }
                }
                return false;
              })()
            `);
                if (leaveTriggered) {
                    await page.wait({ time: 1 });
                    const saveLabels = ['暂存离开', '存草稿', '保存草稿'];
                    const saved = await page.evaluate(`
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
                })(${JSON.stringify(saveLabels)})
              `);
                    if (saved) {
                        invokeResult.ok = true;
                        invokeResult.via = 'leave-save-fallback';
                    }
                }
                // Check if auto-saved
                if (!invokeResult?.ok) {
                    await page.wait({ time: 2 });
                    const autoSaved = await page.evaluate(`
                () => {
                  const markers = ['草稿箱(', '保存于', '编辑于'];
                  for (const el of document.querySelectorAll('*')) {
                    const text = (el.innerText || el.textContent || '').trim();
                    if (text && markers.some(marker => text.includes(marker))) return true;
                  }
                  return false;
                }
              `);
                    if (autoSaved) {
                        invokeResult.ok = true;
                        invokeResult.via = 'auto-save';
                    }
                }
            }
        }
        if (!invokeResult?.ok) {
            await page.screenshot({ path: '/tmp/xhs_publish_submit_debug.png' });
            const viaClause = invokeResult?.via ? ` (via=${invokeResult.via})` : '';
            const errorClause = invokeResult?.error ? `, error=${invokeResult.error}` : '';
            const lastMethodClause = invokeResult?.lastMethodError ? `, lastMethodError=${invokeResult.lastMethodError}` : '';
            throw new Error(`Could not trigger "${actionLabels[0]}" action${viaClause}${errorClause}${lastMethodClause}. ` +
                'Debug screenshot: /tmp/xhs_publish_submit_debug.png');
        }
        // ── Step 8: Verify success ─────────────────────────────────────────────────
        await page.wait({ time: 4 });
        const finalUrl = await page.evaluate('() => location.href');
        const successMarkers = isDraft
            ? ['草稿已保存', '暂存成功', '保存成功', '保存于', '图文笔记(']
            : ['发布成功', '上传成功'];
        const successMsg = await page.evaluate(`
      (markers => {
        for (const el of document.querySelectorAll('*')) {
          if (el.tagName === 'STYLE' || el.tagName === 'SCRIPT') continue;
          const text = (el.innerText || '').trim();
          if (text.length > 200) continue;
          if (el.children.length === 0 && markers.some(marker => text.includes(marker))) return text;
        }
        return '';
      })(${JSON.stringify(successMarkers)})
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
                    addedTopics.length ? `话题: ${addedTopics.join(' ')}` : '',
                    successMsg || finalUrl || '',
                ]
                    .filter(Boolean)
                    .join(' · '),
            },
        ];
    },
});
