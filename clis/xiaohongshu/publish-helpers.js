/**
 * Shared helpers for Xiaohongshu publisher commands (publish.js image notes,
 * publish-video.js video notes): field filling, file upload with typed
 * validation, topic typing primitives, and the publish/draft submission and
 * success verification used by the creator center.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';

export function unwrapBrowserResult(value) {
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

export const PUBLISH_METHOD_NAMES = ['_onPublish', 'onPublish', '_onSubmit', '_handlePublish'];
export const DRAFT_METHOD_NAMES = ['_onSave', '_onSaveDraft', '_onDraft'];
export const TITLE_SELECTORS = [
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
    'input[placeholder*="填写标题"]',
    '[contenteditable="true"][class*="title"]',
    'input[maxlength="20"]',
    'input[class*="title"]',
    '.title-input input',
    '.note-title input',
    'input[maxlength]',
];
/** Selectors for the note body / content editor, ordered by priority. */
export const BODY_SELECTORS = [
    '[contenteditable="true"][class*="content"]',
    '[contenteditable="true"][class*="editor"]',
    '[contenteditable="true"][placeholder*="描述"]',
    '[contenteditable="true"][placeholder*="正文"]',
    '[contenteditable="true"][placeholder*="内容"]',
    '.note-content [contenteditable="true"]',
    '.editor-content [contenteditable="true"]',
    // Broad fallback — last resort; filter out any title contenteditable
    '[contenteditable="true"]:not([placeholder*="标题"]):not([placeholder*="赞"]):not([placeholder*="title" i])',
    '.tiptap.ProseMirror',
];

export const SUPPORTED_EXTENSIONS = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
};

/** CSS selector for image-accepting file inputs. */
export const IMAGE_INPUT_SELECTOR = 'input[type="file"][accept*="image"],'
    + 'input[type="file"][accept*=".jpg"],'
    + 'input[type="file"][accept*=".jpeg"],'
    + 'input[type="file"][accept*=".png"],'
    + 'input[type="file"][accept*=".gif"],'
    + 'input[type="file"][accept*=".webp"]';

export function validateImagePaths(filePaths) {
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

export async function clickByText(page, label, maxWaitMs = 7_000) {
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

export async function fillField(page, selectors, text, fieldName) {
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

export async function uploadImages(page, absPaths) {
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
            // Fall through to the legacy path when the extension cannot run the
            // CDP file-injection flow: unsupported action, Chrome rejecting the
            // debugger, or the intercepted chooser never opening (#2670 — the
            // input itself still accepts DataTransfer injection).
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes('Unknown action') || msg.includes('not supported') || msg.includes('Not allowed') || msg.includes('fileChooserOpened not received')) {
                // Extension too old or chooser suppressed — fall through to legacy base64 method
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

/** Upper bound for a single file uploaded through the base64 fallback path. */
export const BASE64_FALLBACK_MAX_BYTES = 64 * 1024 * 1024;

/**
 * Sniff a file's MIME type from its leading bytes so uploads do not depend on
 * the file extension. Returns null for unknown signatures.
 */
export function sniffMime(filePath) {
    let head;
    try {
        const fd = fs.openSync(filePath, 'r');
        try {
            const buf = Buffer.alloc(32);
            const read = fs.readSync(fd, buf, 0, 32, 0);
            head = buf.subarray(0, read);
        } finally {
            fs.closeSync(fd);
        }
    } catch {
        return null;
    }
    if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
    if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
    if (head.length >= 6 && head.subarray(0, 6).toString('latin1') === 'GIF87a') return 'image/gif';
    if (head.length >= 6 && head.subarray(0, 6).toString('latin1') === 'GIF89a') return 'image/gif';
    if (head.length >= 12 && head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
    if (head.length >= 12 && head.subarray(4, 8).toString('latin1') === 'ftyp') {
        const brand = head.subarray(8, 12).toString('latin1').toLowerCase();
        if (brand.startsWith('qt') || brand.startsWith('m4')) return 'video/quicktime';
        return 'video/mp4';
    }
    return null;
}

/**
 * Validate a media file before any navigation: must exist, sniff to one of the
 * accepted MIME types, and stay under the size cap. Returns { absPath, mime, size }.
 */
export function validateMediaFile(filePath, { accepted, maxBytes, label }) {
    const absPath = path.resolve(String(filePath || '').trim());
    if (!fs.existsSync(absPath)) {
        throw new ArgumentError(`${label} file not found: ${absPath}`);
    }
    const stat = fs.statSync(absPath);
    if (!stat.isFile()) {
        throw new ArgumentError(`${label} is not a file: ${absPath}`);
    }
    if (stat.size <= 0) {
        throw new ArgumentError(`${label} file is empty: ${absPath}`);
    }
    if (maxBytes && stat.size > maxBytes) {
        throw new ArgumentError(`${label} is ${(stat.size / 1024 / 1024).toFixed(1)}MB; the limit is ${(maxBytes / 1024 / 1024).toFixed(0)}MB`);
    }
    const mime = sniffMime(absPath);
    if (!mime || !accepted.includes(mime)) {
        throw new ArgumentError(`${label} is not a supported file type (sniffed ${mime || 'unknown'}); accepted: ${accepted.join(', ')}`);
    }
    return { absPath, mime, size: stat.size };
}

/**
 * Upload files into a file input: page.setFileInput (CDP DOM.setFileInputFiles)
 * first, falling back to in-page base64 DataTransfer injection for bridges
 * without set-file-input support. MIME types come from the file bytes.
 */
export async function uploadFiles(page, absPaths, selector) {
    if (typeof page.setFileInput === 'function') {
        try {
            await page.setFileInput(absPaths, selector);
            return { ok: true, count: absPaths.length, via: 'setFileInput' };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (/Unknown action|not supported|Not allowed|fileChooserOpened not received/i.test(msg)) {
                // Fall through to the in-page injection fallback.
            } else {
                return { ok: false, count: 0, error: msg };
            }
        }
    }
    const files = absPaths.map((absPath) => {
        const size = fs.statSync(absPath).size;
        if (size > BASE64_FALLBACK_MAX_BYTES) {
            throw new CommandExecutionError(
                `${path.basename(absPath)} is ${(size / 1024 / 1024).toFixed(1)}MB and the browser bridge cannot pass it through the fallback path. `
                + 'Update the OpenCLI browser extension to a version with CDP file upload, or compress the file.',
            );
        }
        return { name: path.basename(absPath), mimeType: sniffMime(absPath) || 'application/octet-stream', base64: fs.readFileSync(absPath).toString('base64') };
    });
    return page.evaluate(`
    (async () => {
      const files = ${JSON.stringify(files)};
      const input = document.querySelector(${JSON.stringify(selector)});
      if (!input) return { ok: false, count: 0, error: 'File input not found: ' + ${JSON.stringify(selector)} };
      const dt = new DataTransfer();
      for (const file of files) {
        try {
          const binary = atob(file.base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
          const blob = new Blob([bytes], { type: file.mimeType });
          dt.items.add(new File([blob], file.name, { type: file.mimeType }));
        } catch (e) {
          return { ok: false, count: 0, error: 'Failed to create File: ' + e.message };
        }
      }
      Object.defineProperty(input, 'files', { value: dt.files, writable: false, configurable: true });
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return { ok: true, count: dt.files.length, via: 'dataTransfer' };
    })()
  `);
}

/**
 * Trigger 发布 / 暂存 on the creator center page: the <xhs-publish-btn> web
 * component is backed by a closed shadow root, so host-level .click() does not
 * reach the internal handler — invoke the instance methods directly, then fall
 * back to a text-matched button click, and for drafts to leave-and-save flows.
 * Throws a typed error when no path works.
 */
export async function invokePublishAction(page, isDraft, actionLabels) {
    const invokeResult = await page.evaluate(`
      (cfg => {
        const { isDraftMode, publishNames, draftNames, labels } = cfg;
        const isVisible = (el) => {
          if (!el || el.offsetParent === null) return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        };
        const hosts = Array.from(document.querySelectorAll('xhs-publish-btn')).filter(isVisible);
        const wanted = isDraftMode ? draftNames : publishNames;
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
        const buttons = document.querySelectorAll('button, [role="button"]');
        for (const btn of buttons) {
          const text = (btn.innerText || btn.textContent || '').trim();
          if (labels.some(l => text === l || text.includes(l)) && isVisible(btn) && !btn.disabled) {
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
    if (!invokeResult?.ok && isDraft) {
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
                    if (labels.some(l => text === l || text.includes(l)) && btn.offsetParent !== null && !btn.disabled) {
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
    if (!invokeResult?.ok) {
        const viaClause = invokeResult?.via ? ` (via=${invokeResult.via})` : '';
        const lastMethodClause = invokeResult?.lastMethodError ? `, lastMethodError=${invokeResult.lastMethodError}` : '';
        throw new CommandExecutionError(`Could not trigger "${actionLabels[0]}" action${viaClause}${lastMethodClause}.`);
    }
    return invokeResult;
}

/**
 * Verify the submit actually succeeded: a visible success marker, or
 * navigation away from the publish page. Returns the marker text (may be ''
 * when navigation alone proves success). Throws a typed error otherwise.
 */
export async function verifyPublishSuccess(page, isDraft, extraMarkers = []) {
    await page.wait({ time: 4 });
    const finalUrl = await page.evaluate('() => location.href');
    const successMarkers = [
        ...(isDraft ? ['草稿已保存', '暂存成功', '保存成功', '保存于'] : ['发布成功', '定时发布成功']),
        ...extraMarkers,
    ];
    const successMsg = await page.evaluate(`
      (markers => {
        for (const el of document.querySelectorAll('*')) {
          if (el.tagName === 'STYLE' || el.tagName === 'SCRIPT') continue;
          if (el.closest && el.closest('.tiptap, .ProseMirror, .note-content, .editor-content')) continue;
          const text = (el.innerText || el.textContent || '').trim();
          if (!text || text.length > 200) continue;
          if (el.children.length === 0 && markers.some(marker => text.includes(marker))) return text;
        }
        return '';
      })(${JSON.stringify(successMarkers)})
    `);
    // Navigating away only counts as success when it is not a bounce to a
    // login wall (an expired session must not be reported as 发布成功).
    const navigatedAway = Boolean(finalUrl)
        && !String(finalUrl).includes('/publish/publish')
        && !/login|passport|signin|captcha/i.test(String(finalUrl));
    if (!successMsg && !navigatedAway) {
        throw new CommandExecutionError(
            `${isDraft ? '暂存成功' : '发布成功'} could not be verified: no success marker or post-submit navigation was observed. `
            + `Current URL: ${finalUrl || 'empty'}`,
        );
    }
    return { successMsg, finalUrl };
}

/** Total wait for a video upload + transcode before failing closed. */
export const TRANSCODE_TIMEOUT_MS = 180_000;

/**
 * Wait until a creator-center video upload finished and the editor form
 * rendered. Fails closed on a reported failure or on timeout — a
 * half-uploaded video must not be published.
 */
export async function waitForVideoReady(page, { timeoutMs = TRANSCODE_TIMEOUT_MS, titleSelectors = TITLE_SELECTORS, pollSeconds = 2 } = {}) {
    const deadline = Date.now() + timeoutMs;
    let lastState = null;
    while (Date.now() < deadline) {
        lastState = unwrapBrowserResult(await page.evaluate(`
          (titleSels => {
            const bodyText = document.body.innerText || '';
            const hasForm = titleSels.some((s) => {
              const el = document.querySelector(s);
              return el && el.offsetParent !== null;
            });
            const uploading = bodyText.includes('上传中') || bodyText.includes('转码中') || !!document.querySelector('[class*="progress"][class*="upload"]');
            const failed = bodyText.includes('上传失败') || bodyText.includes('转码失败');
            const done = bodyText.includes('上传成功') || bodyText.includes('重新上传') || bodyText.includes('替换视频') || bodyText.includes('设置封面') || bodyText.includes('修改封面');
            return { hasForm, uploading, done, failed };
          })(${JSON.stringify(titleSelectors)})
        `));
        if (lastState?.failed) {
            throw new CommandExecutionError('Xiaohongshu reported a video upload/transcode failure.');
        }
        if (lastState?.hasForm && lastState?.done && !lastState?.uploading) return;
        await page.wait({ time: pollSeconds });
    }
    throw new CommandExecutionError(
        `Video upload did not finish within ${Math.round(timeoutMs / 1000)}s (last state: ${JSON.stringify(lastState)}). Nothing was published.`,
    );
}

/** Cover images are small; anything larger is a mistake, not a cover. */
export const COVER_MAX_BYTES = 20 * 1024 * 1024;
export const COVER_ACCEPTED_MIMES = ['image/png', 'image/jpeg'];

/**
 * Apply a custom cover to the video note.
 *
 * Flow (creator center, verified 2026-11-09): the cover preview hides
 * 「编辑封面」 until hovered, so the entry is clicked directly in the page;
 * the editor exposes `input[aria-label="上传封面图片"]`, and 「完成」 closes
 * it. Every stage is a postcondition: a requested cover that cannot be
 * opened, uploaded or confirmed throws — the publish must not silently fall
 * back to the default frame.
 */
export async function uploadCover(page, coverPath) {
    const opened = unwrapBrowserResult(await page.evaluate(`
      (() => {
        const entry = document.querySelector('.cover-edit-entry');
        if (entry) { entry.click(); return true; }
        const labels = ['编辑封面', '设置封面', '修改封面', '更换封面'];
        const el = Array.from(document.querySelectorAll('div,span,button'))
          .find(node => node.offsetParent !== null && labels.includes((node.textContent || '').trim()));
        if (!el) return false;
        el.click();
        return true;
      })()
    `));
    if (!opened) {
        throw new CommandExecutionError('Cover editor entry was not found on the publish page.');
    }
    await page.wait({ time: 2 });

    const selector = unwrapBrowserResult(await page.evaluate(`
      (() => {
        let input = document.querySelector('input[aria-label="上传封面图片"]');
        if (!input) {
          const clear = document.querySelector('.uploaded-thumbnail-clear');
          if (clear) clear.click();
          input = document.querySelector('input[aria-label="上传封面图片"]');
        }
        if (!input) {
          input = Array.from(document.querySelectorAll('input[type="file"]')).find(el => {
            const accept = (el.getAttribute('accept') || '').toLowerCase();
            const aria = el.getAttribute('aria-label') || '';
            return /image|png|jpe?g/.test(accept) || /封面/.test(aria);
          });
        }
        if (!input) return null;
        input.setAttribute('data-opencli-cover-input', '1');
        return 'input[data-opencli-cover-input="1"]';
      })()
    `));
    if (!selector) {
        throw new CommandExecutionError('Cover upload input was not found after opening the cover editor.');
    }

    const uploaded = await uploadFiles(page, [coverPath], selector);
    if (!uploaded?.ok) {
        throw new CommandExecutionError(`Cover upload failed: ${uploaded?.error || 'unknown'}. Nothing was published.`);
    }
    await page.wait({ time: 3 });

    let confirmed = false;
    for (let attempt = 0; attempt < 3 && !confirmed; attempt += 1) {
        confirmed = Boolean(unwrapBrowserResult(await page.evaluate(`
          (() => {
            const btn = Array.from(document.querySelectorAll('button, .d-button'))
              .find(el => el.offsetParent !== null && (el.textContent || '').trim() === '完成');
            if (!btn) return false;
            btn.click();
            return true;
          })()
        `)));
        if (!confirmed) await page.wait({ time: 1 });
    }
    if (!confirmed) {
        throw new CommandExecutionError('Cover editor confirm (完成) was not found; the cover was not applied.');
    }
    await page.wait({ time: 2 });

    const applied = unwrapBrowserResult(await page.evaluate(`
      (() => {
        const preview = document.querySelector('.default.row, .cover-plugin-preview img');
        if (!preview) return false;
        if (preview.tagName === 'IMG') return Boolean(preview.getAttribute('src'));
        return /url\\(/.test(getComputedStyle(preview).backgroundImage || '');
      })()
    `));
    if (!applied) {
        throw new CommandExecutionError('Cover preview did not update after confirming; the cover was not applied.');
    }
    return 'ok';
}

/**
 * Set the note's content-type declaration. Only `ai` is supported today:
 * 「笔记含AI合成内容」. The control is a d-select whose options are mounted
 * hidden until the select is opened, so the option is clicked by exact text.
 */
export async function selectDeclaration(page, declaration) {
    const value = String(declaration || '').trim().toLowerCase();
    if (value !== 'ai') {
        throw new ArgumentError(`Unsupported --declaration value: ${declaration}. Only "ai" is supported.`);
    }
    const label = '笔记含AI合成内容';

    const opened = unwrapBrowserResult(await page.evaluate(`
      (() => {
        const host = Array.from(document.querySelectorAll('.wrapper, .d-select-wrapper'))
          .find(el => el && el.offsetParent !== null && /添加内容类型声明|内容类型声明|AI合成/.test(el.innerText || ''));
        if (!host) return false;
        host.scrollIntoView({ block: 'center' });
        const select = host.querySelector('.d-select') || host;
        select.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        select.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        select.click();
        return true;
      })()
    `));
    if (!opened) {
        throw new CommandExecutionError('Content-type declaration control was not found on the publish page.');
    }
    await page.wait({ time: 1 });

    const clicked = unwrapBrowserResult(await page.evaluate(`
      (label => {
        const visible = Array.from(document.querySelectorAll('.d-option, [role="option"]'))
          .filter(el => el && el.offsetParent !== null && (el.textContent || '').trim() === label);
        const all = Array.from(document.querySelectorAll('.d-option, [role="option"], div, span'))
          .filter(el => el && (el.textContent || '').trim() === label);
        const el = visible[visible.length - 1] || all[all.length - 1];
        if (!el) return false;
        el.click();
        return true;
      })(${JSON.stringify(label)})
    `));
    if (!clicked) {
        throw new CommandExecutionError(`Declaration option "${label}" was not found; refusing to publish without it.`);
    }
    await page.wait({ time: 1.5 });

    const applied = unwrapBrowserResult(await page.evaluate(`
      (label => {
        const host = Array.from(document.querySelectorAll('.wrapper, .d-select-wrapper'))
          .find(el => el && el.offsetParent !== null && /内容类型声明|AI合成/.test(el.innerText || ''));
        return Boolean(host && (host.innerText || '').includes(label));
      })(${JSON.stringify(label)})
    `));
    if (!applied) {
        throw new CommandExecutionError('The declaration was not applied; refusing to publish without it.');
    }
    return label;
}
