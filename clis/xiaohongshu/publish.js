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
import { CommandExecutionError, ArgumentError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
const PUBLISH_URL = 'https://creator.xiaohongshu.com/publish/publish?from=menu_left&target=image';
const MAX_IMAGES = 9;
const MAX_TITLE_LEN = 20;
const UPLOAD_SETTLE_MS = 3000;
const CARD_TEXT_DELIM = '|||';
const DEFAULT_CARD_STYLE = '基础';
// Example styles for help text only — the real options are read live from the
// (virtualized, content-dependent) 预览图片 strip at runtime, so this list is NOT
// used to validate input; an unavailable requested style fails before submit.
// 文字配图 --card-style catalog: each style name → the content it suits.
// Styles are read live from the page at runtime (see selectCardStyle); this list
// only powers --help, and an unmatched requested style is a typed failure.
const CARD_STYLE_GUIDE = [
    ['基础', '默认兜底，万能'],
    ['边框', '金句/要点卡'],
    ['备忘', '提醒/随手记'],
    ['清新', '日常/清单贴士'],
    ['涂写', '随笔/碎碎念'],
    ['便签', '笔记/提醒'],
    ['光影', '情绪/文艺'],
    ['涂鸦', '趣味/童话'],
    ['简约', '干货/观点'],
    ['手写', '日记/情感'],
    ['插图', '生活方式/轻松话题'],
    ['美漫', '活力/趣味/故事感'],
    ['弥散', '弥散光氛围'],
    ['柔和', '柔和/温柔金句'],
    ['印刷', '印刷海报/排版'],
    ['科技', '科技/产品'],
    ['贺卡', '节日祝福'],
    ['札记', '艺术/水彩氛围'],
    ['书摘', '书摘/引用'],
    ['手帐', '手帐拼贴'],
    ['几何', '醒目/有力主张'],
];
const CARD_STYLES = CARD_STYLE_GUIDE.map(([name]) => name);
const TEXT_IMAGE_ENTRY_LABEL = '文字配图';
const ADD_CARD_LABEL = '再写一张';
const GENERATE_LABEL = '生成图片';
const PREVIEW_NEXT_LABEL = '下一步';
/** tiptap/ProseMirror card editor inside the 写文字 swiper. */
const CARD_EDITOR_SELECTOR = '.tiptap.ProseMirror';
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
            throw new ArgumentError(`Image file not found: ${absPath}`);
        const ext = path.extname(absPath).toLowerCase();
        if (!SUPPORTED_EXTENSIONS[ext]) {
            throw new ArgumentError(`Unsupported image format "${ext}". Supported: jpg, png, gif, webp`);
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
function topicMarkerCountScript(topic, bodySelectors) {
    return `
    ((topicName, selectors) => {
      const __opencli_xhs_topic_marker_count = true;
      const marker = '#' + topicName + '[话题]';
      const editor = selectors
        .map(sel => Array.from(document.querySelectorAll(sel)))
        .flat()
        .find(node => node && node.offsetParent !== null && node.isContentEditable);
      if (!editor || !marker) return 0;
      const text = editor.innerText || editor.textContent || '';
      let count = 0;
      let index = text.indexOf(marker);
      while (index !== -1) {
        count += 1;
        index = text.indexOf(marker, index + marker.length);
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
        const beforeMarkerCount = Number(unwrapBrowserResult(await page.evaluate(topicMarkerCountScript(topic, bodySelectors)))) || 0;
        // Separate this topic from the preceding text so the dropdown is clean.
        if (typeof page.pressKey === 'function') {
            try {
                await page.pressKey('Enter');
            }
            catch { /* non-fatal */ }
        }
        // Type the inline "#<topic>" query so XHS pops the inline suggestion
        // dropdown. We must use `page.insertText` (CDP) rather than the legacy
        // `execCommand` path, otherwise XHS's editor doesn't fire its keyup
        // listener and no dropdown appears.
        if (typeof page.insertText !== 'function') {
            throw new CommandExecutionError(`Could not attach topic "${topic}": page.insertText is unavailable`);
        }
        try {
            await page.insertText(`#${topic}`);
        }
        catch {
            throw new CommandExecutionError(`Could not attach topic "${topic}": failed to type inline topic query`);
        }
        await page.wait({ time: 1.2 }); // Let the suggestion dropdown render.
        // The suggestion dropdown lives inside the editor's closed shadow root,
        // so light-DOM queries cannot enumerate its items. XHS auto-highlights
        // the first matching suggestion as soon as the query is typed, so
        // pressing Enter accepts it directly. `page.nativeClick` would also
        // work but is not always wired up in the browser-bridge wrapper.
        if (typeof page.pressKey !== 'function') {
            throw new CommandExecutionError(`Could not attach topic "${topic}": page.pressKey is unavailable`);
        }
        try {
            await page.pressKey('Enter');
        }
        catch (err) {
            throw new CommandExecutionError(`Could not attach topic "${topic}": failed to accept suggestion (${err && err.message || err})`);
        }
        await page.wait({ time: 0.8 });
        // Verify the topic chip actually rendered. The chip itself lives in a
        // closed shadow root so we cannot count `<a>` elements, but XHS exposes
        // a stable "#<topic>[话题]" marker in the body editor's innerText once
        // the suggestion is accepted. Require the scoped marker count to
        // increase so an existing marker elsewhere cannot satisfy the write
        // postcondition.
        const afterMarkerCount = Number(unwrapBrowserResult(await page.evaluate(topicMarkerCountScript(topic, bodySelectors)))) || 0;
        if (afterMarkerCount <= beforeMarkerCount) {
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
/**
 * Click the first visible element whose trimmed text equals `label`.
 * Marker constant `__opencli_xhs_click_label` lets the test mock branch on it.
 */
async function clickByText(page, label, maxWaitMs = 7_000) {
    const pollMs = 500;
    const maxAttempts = Math.max(1, Math.ceil(maxWaitMs / pollMs));
    let result = { ok: false };
    // Retry until the control appears: 生成图片 → 下一步 advances through async
    // render/generation steps, so the target may not exist on the first probe.
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        result = unwrapBrowserResult(await page.evaluate(`
    ((cfg) => {
      const __opencli_xhs_click_label = { wantLabel: ${JSON.stringify(label)} };
      const wantLabel = ${JSON.stringify(label)};
      const isVisible = (el) => {
        if (!el || el.offsetParent === null) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const norm = (v) => (v || '').replace(/\\s+/g, ' ').trim();
      const clickable = (el) => el.closest('button, [role="button"], a, label') || el;
      const enabled = (el) =>
        !(el.getAttribute && el.getAttribute('aria-disabled') === 'true')
        && !el.disabled
        && !(el.className && String(el.className).split(/\\s+/).includes('disabled'));
      // Exact-text matches, innermost first. The real click handler usually lives on
      // an inner control (.edit-text-button 生成图片, .add-text-item-button-text 再写一张);
      // an outer wrapper that merely *contains* the label is a no-op, so prefer the
      // deepest matching node and let the event bubble up to the handler.
      const nodes = Array.from(document.querySelectorAll('button, [role="button"], div, span, a, label, li'));
      const exact = nodes.filter((n) => isVisible(n) && norm(n.innerText || n.textContent) === wantLabel);
      const innermost = exact.filter((n) => !exact.some((o) => o !== n && n.contains(o)));
      const contains = nodes.filter((n) => {
        if (!isVisible(n)) return false;
        const t = norm(n.innerText || n.textContent);
        return t && t.length <= wantLabel.length + 4 && t.includes(wantLabel);
      });
      for (const node of [...(innermost.length ? innermost : exact), ...contains]) {
        const c = clickable(node);
        if (!enabled(c)) continue;
        c.click();
        return { ok: true, text: norm(node.innerText || node.textContent) || wantLabel };
      }
      return { ok: false };
    })()
  `));
        if (result?.ok)
            return result;
        await page.wait({ time: pollMs / 1_000 });
    }
    return result;
}
/**
 * Focus the currently-active 写文字 card editor (tiptap/ProseMirror) and move the
 * caret to the end so insertText appends into it.
 */
async function focusActiveCard(page) {
    const result = await page.evaluate(`
    (() => {
      const __opencli_xhs_focus_card = true;
      const sel = ${JSON.stringify(CARD_EDITOR_SELECTOR)};
      const editors = Array.from(document.querySelectorAll(sel)).filter((el) => el.offsetParent !== null);
      // Prefer the editor inside the active swiper slide if present.
      const active = editors.find((el) => el.closest('.swiper-slide-active')) || editors[editors.length - 1];
      if (!active) return { ok: false };
      active.focus();
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(active);
      range.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(range);
      return { ok: true };
    })()
  `);
    return unwrapBrowserResult(result);
}
/** Confirm the active card editor holds non-empty text (guards against empty cards). */
async function activeCardText(page) {
    const result = await page.evaluate(`
    (() => {
      const __opencli_xhs_card_text = true;
      const sel = ${JSON.stringify(CARD_EDITOR_SELECTOR)};
      const editors = Array.from(document.querySelectorAll(sel)).filter((el) => el.offsetParent !== null);
      const active = editors.find((el) => el.closest('.swiper-slide-active')) || editors[editors.length - 1];
      const text = active ? (active.innerText || active.textContent || '').trim() : '';
      return { ok: !!text, text };
    })()
  `);
    return unwrapBrowserResult(result);
}
/**
 * Count visible card editors and report whether the active one is still empty.
 * Used to wait out the swiper render lag after clicking 再写一张.
 */
async function cardEditorState(page) {
    const result = await page.evaluate(`
    (() => {
      const __opencli_xhs_card_count = true;
      const sel = ${JSON.stringify(CARD_EDITOR_SELECTOR)};
      const editors = Array.from(document.querySelectorAll(sel)).filter((el) => el.offsetParent !== null);
      const active = editors.find((el) => el.closest('.swiper-slide-active')) || editors[editors.length - 1];
      const activeText = active ? (active.innerText || active.textContent || '').trim() : '';
      return { ok: true, count: editors.length, activeEmpty: !activeText };
    })()
  `);
    return unwrapBrowserResult(result);
}
/** Poll until at least one card editor has rendered (after entering 文字配图). */
async function waitForFirstCard(page, maxWaitMs = 8_000) {
    const pollMs = 300;
    const maxAttempts = Math.ceil(maxWaitMs / pollMs);
    for (let i = 0; i < maxAttempts; i++) {
        const state = await cardEditorState(page);
        if (state?.count >= 1)
            return true;
        await page.wait({ time: pollMs / 1_000 });
    }
    return false;
}
/**
 * After clicking 再写一张, the new card editor renders asynchronously and only
 * then becomes the active swiper slide. Wait for the fresh empty card to be
 * active before typing — otherwise the text lands in the previous card and the
 * cards get merged.
 */
async function waitForNewCard(page, expectedCount, maxWaitMs = 6_000) {
    const pollMs = 300;
    const maxAttempts = Math.ceil(maxWaitMs / pollMs);
    for (let i = 0; i < maxAttempts; i++) {
        const state = await cardEditorState(page);
        if (state?.count >= expectedCount && state?.activeEmpty)
            return true;
        await page.wait({ time: pollMs / 1_000 });
    }
    return false;
}
/**
 * Click 再写一张 and wait for the new card to render. Retries the click because
 * 再写一张 only adds a card once the current card's text has registered in the
 * editor model — a click fired too early no-ops. Re-clicking is safe: once the
 * fresh empty card is active, 再写一张 no-ops, so this never over-adds.
 */
async function addCard(page, expectedCount, maxAttempts = 4) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const clicked = await clickByText(page, ADD_CARD_LABEL);
        if (!clicked?.ok)
            return false;
        if (await waitForNewCard(page, expectedCount, 2_500))
            return true;
    }
    return false;
}
/** True once the 预览图片 step has rendered (its 下一步 button is present). */
async function previewStepReady(page) {
    const result = await page.evaluate(`
    (() => {
      const __opencli_xhs_preview_ready = true;
      const ready = Array.from(document.querySelectorAll('button'))
        .some((b) => b.offsetParent !== null && (b.innerText || '').replace(/\\s+/g, '') === '下一步');
      return { ok: ready };
    })()
  `);
    return unwrapBrowserResult(result);
}
/**
 * Click 生成图片 and wait for the 预览图片 step. Retries the click because 生成图片
 * no-ops until the card text has registered in the editor model (same timing quirk as
 * 再写一张). Re-clicking is safe: once the preview step is showing, 生成图片 is gone.
 */
async function clickGenerate(page, maxAttempts = 6) {
    const pollMs = 400;
    const polls = Math.ceil(3_000 / pollMs);
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const clicked = await clickByText(page, GENERATE_LABEL);
        if (!clicked?.ok && attempt === 0)
            return false; // 生成图片 not on the page at all
        for (let i = 0; i < polls; i++) {
            if ((await previewStepReady(page))?.ok)
                return true;
            await page.wait({ time: pollMs / 1_000 });
        }
    }
    return false;
}
/**
 * Type one card's text into the active card editor, then verify it stuck.
 *
 * tiptap/ProseMirror swallows a "\n" embedded in a single insertText call, so a
 * multi-line card would collapse onto one line. Split the text on "\n" and press
 * Enter between segments to produce real line breaks (same Enter mechanism
 * addTopics relies on). An empty segment (consecutive "\n") yields a blank line.
 *
 * Single-quoted shell args (the most natural way to pass `--card-text`) deliver a
 * literal backslash + "n", not a real LF, so we normalize those to real newlines
 * first — both `$'a\nb'` and `'a\nb'` then break lines identically.
 */
async function fillCard(page, text, index) {
    text = String(text).replace(/\\n/g, '\n');
    const focused = await focusActiveCard(page);
    if (!focused?.ok)
        throw new CommandExecutionError(`文字配图: could not focus card editor #${index + 1}`);
    if (typeof page.insertText === 'function') {
        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i++) {
            if (i > 0 && typeof page.pressKey === 'function')
                await page.pressKey('Enter');
            if (lines[i])
                await page.insertText(lines[i]);
        }
    }
    else {
        await page.evaluate(`(t => document.execCommand('insertText', false, t))(${JSON.stringify(text)})`);
    }
    await page.wait({ time: 0.4 });
    const state = await activeCardText(page);
    if (!state?.ok)
        throw new CommandExecutionError(`文字配图: card editor #${index + 1} is empty after typing`);
}
/**
 * On the 预览图片 step, optionally pick a style. The style picker is a
 * scrollable strip whose options are loaded lazily, so we scroll it to the end
 * to surface every option, then read the real on-page labels (no hard-coded
 * whitelist — XHS adds/removes styles over time). The strip is located by
 * anchoring on a known seed label (e.g. 基础) rather than a volatile class name.
 *
 * If the caller requested a style, it is a write-side postcondition: either
 * that style is available and clicked, or publishing fails before submit.
 */
async function selectCardStyle(page, styleName) {
    if (!styleName || styleName === DEFAULT_CARD_STYLE)
        return DEFAULT_CARD_STYLE; // default 基础 is preselected — nothing to do.
    // The style strip (".cover-list-container") is VIRTUALIZED: only the items
    // near the viewport are in the DOM, so a single read sees ~10 of ~20 options
    // and an option scrolled out of view cannot be clicked. Step-scroll the strip
    // (".cover-list-container-wrapper"), accumulating every label seen; stop as
    // soon as the requested style appears and scroll it into view so the
    // subsequent click lands. XHS also shows a content-dependent subset, so the
    // real options vary per note — hence no static whitelist.
    const available = unwrapBrowserResult(await page.evaluate(`
    (async () => {
      const __opencli_xhs_card_styles = true;
      const want = ${JSON.stringify(styleName)};
      const norm = (el) => ((el && (el.innerText || el.textContent)) || '').trim();
      const names = () => Array.from(document.querySelectorAll('.cover-list-container .cover-name'));
      const seen = [];
      const readAll = () => { for (const el of names()) { const t = norm(el); if (t && !seen.includes(t)) seen.push(t); } };
      const target = () => names().find((el) => norm(el) === want);
      const reveal = (el) => { el.scrollIntoView({ block: 'center' }); };
      readAll();
      let hit = target();
      if (hit) { reveal(hit); return { ok: true, styles: seen, found: true }; }
      const scroller = document.querySelector('.cover-list-container-wrapper')
        || document.querySelector('.cover-list-container');
      if (scroller) {
        const ch = scroller.clientHeight || 200;
        const sh = scroller.scrollHeight;
        for (let y = 0; y <= sh + ch; y += Math.max(60, Math.floor(ch / 2))) {
          scroller.scrollTop = y;
          await new Promise((r) => setTimeout(r, 180));
          readAll();
          hit = target();
          if (hit) { reveal(hit); await new Promise((r) => setTimeout(r, 150)); return { ok: true, styles: seen, found: true }; }
        }
        scroller.scrollTop = 0;
      }
      return { ok: seen.length > 0, styles: seen, found: false };
    })()
  `));
    if (!available?.found) {
        throw new CommandExecutionError(`文字配图: requested style "${styleName}" is not available for this content `
            + `(options: ${(available?.styles || []).join(' / ') || 'none'}). `
            + `Choose an available style or omit --card-style to use ${DEFAULT_CARD_STYLE}.`);
    }
    const clicked = await clickByText(page, styleName);
    if (!clicked?.ok) {
        throw new CommandExecutionError(`文字配图: could not click requested style "${styleName}".`);
    }
    await page.wait({ time: 0.6 });
    return styleName;
}
/**
 * Count visible media in the current editor/composer. Text-image generation must
 * produce real image cards before we fill title/body or submit; otherwise a
 * no-op 生成图片 / 下一步 sequence can publish the wrong draft surface.
 */
async function currentComposerMediaCount(page) {
    const result = await page.evaluate(`
    (() => {
      const __opencli_xhs_composer_media_count = true;
      const visibleBox = (el) => {
        if (!el || el.offsetParent === null) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const visibleMedia = (el) => {
        if (!visibleBox(el)) return false;
        const r = el.getBoundingClientRect();
        return r.width >= 48 && r.height >= 48;
      };
      const titleSelectors = ${JSON.stringify(TITLE_SELECTORS)};
      const titleEl = titleSelectors
        .map((sel) => Array.from(document.querySelectorAll(sel)))
        .flat()
        .find((el) => visibleBox(el));
      const root = titleEl?.closest('form, [class*="publish"], [class*="editor"], [class*="note"]') || document.body;
      const seen = new Set();
      let count = 0;
      for (const el of Array.from(root.querySelectorAll('img, video, canvas, [style*="background-image"]'))) {
        if (!visibleMedia(el)) continue;
        const rect = el.getBoundingClientRect();
        const src = el.currentSrc || el.src || el.getAttribute('src') || el.style?.backgroundImage || '';
        const key = src || String(Math.round(rect.left)) + ':' + String(Math.round(rect.top));
        if (seen.has(key)) continue;
        seen.add(key);
        count += 1;
      }
      return { ok: true, count };
    })()
  `);
    return unwrapBrowserResult(result);
}
async function assertComposerMediaCount(page, expectedCount, label) {
    const state = await currentComposerMediaCount(page);
    if (!state || typeof state.count !== 'number') {
        throw new CommandExecutionError(`${label}: could not verify current composer media count`);
    }
    if (state.count < expectedCount) {
        await page.screenshot({ path: '/tmp/xhs_publish_media_debug.png' });
        throw new CommandExecutionError(`${label}: expected at least ${expectedCount} visible media item(s), got ${state.count}. ` +
            'Debug screenshot: /tmp/xhs_publish_media_debug.png');
    }
}
/**
 * Drive the full 文字配图 sub-flow: entry → type cards → 生成图片 → pick style → 下一步.
 * Leaves the page on the standard editor (caller then runs waitForEditForm).
 */
async function runTextImageFlow(page, cards, cardStyle) {
    const entry = await clickByText(page, TEXT_IMAGE_ENTRY_LABEL);
    if (!entry?.ok) {
        await page.screenshot({ path: '/tmp/xhs_publish_textimage_debug.png' });
        throw new CommandExecutionError(`文字配图: could not click "${TEXT_IMAGE_ENTRY_LABEL}" entry. ` +
            'Debug: /tmp/xhs_publish_textimage_debug.png');
    }
    if (!(await waitForFirstCard(page))) {
        await page.screenshot({ path: '/tmp/xhs_publish_textimage_debug.png' });
        throw new CommandExecutionError(`文字配图: 写文字 card editor did not appear after clicking "${TEXT_IMAGE_ENTRY_LABEL}". ` +
            'Debug: /tmp/xhs_publish_textimage_debug.png');
    }
    for (let i = 0; i < cards.length; i++) {
        if (i > 0) {
            const added = await addCard(page, i + 1);
            if (!added) {
                await page.screenshot({ path: '/tmp/xhs_publish_addcard_debug.png' });
                throw new CommandExecutionError(`文字配图: new card editor #${i + 1} did not render after "${ADD_CARD_LABEL}". ` +
                    'Debug: /tmp/xhs_publish_addcard_debug.png');
            }
        }
        await fillCard(page, cards[i], i);
    }
    const generated = await clickGenerate(page);
    if (!generated) {
        await page.screenshot({ path: '/tmp/xhs_publish_generate_debug.png' });
        throw new CommandExecutionError(`文字配图: "${GENERATE_LABEL}" did not advance to the 预览图片 step. ` +
            'Debug: /tmp/xhs_publish_generate_debug.png');
    }
    const appliedStyle = await selectCardStyle(page, cardStyle);
    const next = await clickByText(page, PREVIEW_NEXT_LABEL);
    if (!next?.ok) {
        await page.screenshot({ path: '/tmp/xhs_publish_next_debug.png' });
        throw new CommandExecutionError(`文字配图: could not click "${PREVIEW_NEXT_LABEL}". ` +
            'Debug: /tmp/xhs_publish_next_debug.png');
    }
    await page.wait({ time: 2 }); // editor render
    return appliedStyle;
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
        { name: 'content', required: true, positional: true, help: '笔记正文' },
        { name: 'title', required: true, help: '笔记标题 (最多20字)' },
        { name: 'images', required: false, help: '图片路径，逗号分隔，最多9张 (jpg/png/gif/webp)' },
        { name: 'card-text', required: false, help: `文字配图卡片文字，多张卡片用 ${CARD_TEXT_DELIM} 分隔，卡内换行用 \\n` },
        { name: 'card-style', required: false, help: `文字配图卡片样式，运行时按页面实际选项匹配；找不到会失败。省略时使用${DEFAULT_CARD_STYLE}。可选: ${CARD_STYLE_GUIDE.map(([n, s]) => `${n}(${s})`).join(' ')}` },
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
        const cardText = kwargs['card-text'] ? String(kwargs['card-text']) : '';
        const cards = cardText
            ? cardText.split(CARD_TEXT_DELIM).map((s) => s.trim()).filter(Boolean)
            : [];
        const cardStyle = kwargs['card-style'] ? String(kwargs['card-style']).trim() : '';
        const isTextImage = cards.length > 0;
        // ── Validate inputs ────────────────────────────────────────────────────────
        if (!title)
            throw new ArgumentError('--title is required');
        if (title.length > MAX_TITLE_LEN)
            throw new ArgumentError(`Title is ${title.length} chars — must be ≤ ${MAX_TITLE_LEN}`);
        if (!content)
            throw new ArgumentError('Positional argument <content> is required');
        if (!isTextImage && imagePaths.length === 0)
            throw new ArgumentError('Provide --card-text (text-image mode) or --images (upload mode); neither was given.');
        if (imagePaths.length > MAX_IMAGES)
            throw new ArgumentError(`Too many images: ${imagePaths.length} (max ${MAX_IMAGES})`);
        // The editor-page image input (text-image append) rejects gif.
        if (isTextImage && imagePaths.some((p) => path.extname(p).toLowerCase() === '.gif'))
            throw new ArgumentError('文字配图模式追加的图片不支持 .gif（编辑器图片入口只接受 jpg/jpeg/png/webp）');
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
        // ── Step 3: Acquire images — text-image generation and/or upload ──────────
        let appliedCardStyle = cardStyle;
        if (isTextImage) {
            // Drive 文字配图: type cards → 生成图片 → pick style → 下一步 → standard editor.
            appliedCardStyle = await runTextImageFlow(page, cards, cardStyle);
        }
        else {
            const upload = await uploadImages(page, absImagePaths);
            if (!upload.ok) {
                await page.screenshot({ path: '/tmp/xhs_publish_upload_debug.png' });
                throw new CommandExecutionError(`Image injection failed: ${upload.error ?? 'unknown'}. ` +
                    'Debug screenshot: /tmp/xhs_publish_upload_debug.png');
            }
            await page.wait({ time: UPLOAD_SETTLE_MS / 1_000 });
            await waitForUploads(page);
        }
        // ── Step 3b: Wait for editor form to render ───────────────────────────────
        const formReady = await waitForEditForm(page);
        if (!formReady) {
            await page.screenshot({ path: '/tmp/xhs_publish_form_debug.png' });
            throw new CommandExecutionError('Editing form did not appear after image acquisition. The page layout may have changed. ' +
                'Debug screenshot: /tmp/xhs_publish_form_debug.png');
        }
        if (isTextImage) {
            await assertComposerMediaCount(page, cards.length, '文字配图 generated images');
        }
        // ── Step 3c: In text-image mode, optionally append uploaded images ────────
        if (isTextImage && absImagePaths.length > 0) {
            const upload = await uploadImages(page, absImagePaths);
            if (!upload.ok) {
                await page.screenshot({ path: '/tmp/xhs_publish_append_debug.png' });
                throw new CommandExecutionError(`Appending images failed: ${upload.error ?? 'unknown'}. ` +
                    'Debug screenshot: /tmp/xhs_publish_append_debug.png');
            }
            await page.wait({ time: UPLOAD_SETTLE_MS / 1_000 });
            await waitForUploads(page);
            await assertComposerMediaCount(page, cards.length + absImagePaths.length, '文字配图 appended images');
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
        if (!isSuccess) {
            throw new CommandExecutionError(`${verb} could not be verified: no success marker or post-submit navigation was observed. ` +
                (finalUrl ? `Current URL: ${finalUrl}` : 'Current URL was empty.'));
        }
        return [
            {
                status: `✅ ${verb}`,
                detail: [
                    `"${title}"`,
                    isTextImage
                        ? `${cards.length}张文字配图${absImagePaths.length ? ` + ${absImagePaths.length}张图片` : ''}${appliedCardStyle && appliedCardStyle !== DEFAULT_CARD_STYLE ? ` (${appliedCardStyle})` : ''}`
                        : `${absImagePaths.length}张图片`,
                    addedTopics.length ? `话题: ${addedTopics.join(' ')}` : '',
                    successMsg || finalUrl || '',
                ]
                    .filter(Boolean)
                    .join(' · '),
            },
        ];
    },
});
