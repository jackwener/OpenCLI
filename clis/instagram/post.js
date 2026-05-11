import * as fs from 'node:fs';
import * as path from 'node:path';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { installInstagramProtocolCapture, readInstagramProtocolCapture, } from './_shared/protocol-capture.js';
import { publishMediaViaPrivateApi, publishImagesViaPrivateApi, resolveInstagramPrivatePublishConfig, } from './_shared/private-publish.js';
import { resolveInstagramRuntimeInfo } from './_shared/runtime-info.js';
const INSTAGRAM_HOME_URL = 'https://www.instagram.com/';
const SUPPORTED_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const SUPPORTED_VIDEO_EXTENSIONS = new Set(['.mp4']);
const MAX_MEDIA_ITEMS = 10;
const INSTAGRAM_PROTOCOL_TRACE_OUTPUT_PATH = '/tmp/instagram_post_protocol_trace.json';
async function gotoInstagramHome(page, forceReload = false) {
    if (forceReload) {
        await page.goto(`${INSTAGRAM_HOME_URL}?__opencli_reset=${Date.now()}`);
        await page.wait({ time: 1 });
    }
    await page.goto(INSTAGRAM_HOME_URL);
}
export function buildEnsureComposerOpenJs() {
    return `
    (() => {
      const path = window.location?.pathname || '';
      const onLoginRoute = /\\/accounts\\/login\\/?/.test(path);
      const hasLoginField = !!document.querySelector('input[name="username"], input[name="password"]');
      const hasLoginButton = Array.from(document.querySelectorAll('button, div[role="button"]')).some((el) => {
        const text = (el.textContent || '').replace(/\\s+/g, ' ').trim().toLowerCase();
        return text === 'log in' || text === 'login' || text === '登录';
      });

      if (onLoginRoute || (hasLoginField && hasLoginButton)) {
        return { ok: false, reason: 'auth' };
      }

      const alreadyOpen = document.querySelector('input[type="file"]');
      if (alreadyOpen) return { ok: true };

      const labels = ['Create', 'New post', 'Post', '创建', '新帖子'];
      const nodes = Array.from(document.querySelectorAll('a, button, div[role="button"], svg[aria-label], [aria-label]'));
      for (const node of nodes) {
        const text = ((node.textContent || '') + ' ' + (node.getAttribute?.('aria-label') || '')).trim();
        if (labels.some((label) => text.toLowerCase().includes(label.toLowerCase()))) {
          const clickable = node.closest('a, button, div[role="button"]') || node;
          if (clickable instanceof HTMLElement) {
            clickable.click();
            return { ok: true };
          }
        }
      }

      return { ok: true };
    })()
  `;
}
export function buildPublishStatusProbeJs() {
    return `
    (() => {
      const isVisible = (el) => {
        if (!(el instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none'
          && style.visibility !== 'hidden'
          && rect.width > 0
          && rect.height > 0;
      };
      const dialogs = Array.from(document.querySelectorAll('[role="dialog"]')).filter((el) => isVisible(el));
      const dialogText = dialogs
        .map((el) => (el.textContent || '').replace(/\\s+/g, ' ').trim())
        .join(' ');
      const url = window.location.href;
      const visibleText = dialogText.toLowerCase();
      const sharingVisible = /sharing/.test(visibleText);
      const shared = /post shared|your post has been shared|已分享|已发布/.test(visibleText)
        || /\\/p\\//.test(url);
      const failed = !shared && !sharingVisible && (
        /couldn['’]t be shared|could not be shared|failed to share|share failed|无法分享|分享失败/.test(visibleText)
        || (/something went wrong/.test(visibleText) && /try again/.test(visibleText))
      );
      const composerOpen = dialogs.some((dialog) =>
        !!dialog.querySelector('textarea, [contenteditable="true"], input[type="file"]')
        || /write a caption|add location|advanced settings|select from computer|crop|filters|adjustments|sharing/.test((dialog.textContent || '').toLowerCase())
      );
      const settled = !shared && !composerOpen && !/sharing/.test(visibleText);
      return { ok: shared, failed, settled, url: /\\/p\\//.test(url) ? url : '' };
    })()
  `;
}
function requirePage(page) {
    if (!page)
        throw new CommandExecutionError('Browser session required for instagram post');
    return page;
}
function validateMixedMediaItems(inputs) {
    if (!inputs.length) {
        throw new ArgumentError('Argument "media" is required.', 'Provide --media /path/to/file.jpg or --media /path/a.jpg,/path/b.mp4');
    }
    if (inputs.length > MAX_MEDIA_ITEMS) {
        throw new ArgumentError(`Too many media items: ${inputs.length}`, `Instagram carousel posts support at most ${MAX_MEDIA_ITEMS} items`);
    }
    const items = inputs.map((input) => {
        const resolved = path.resolve(String(input || '').trim());
        if (!resolved) {
            throw new ArgumentError('Media path cannot be empty');
        }
        if (!fs.existsSync(resolved)) {
            throw new ArgumentError(`Media file not found: ${resolved}`);
        }
        const ext = path.extname(resolved).toLowerCase();
        if (SUPPORTED_IMAGE_EXTENSIONS.has(ext)) {
            return { type: 'image', filePath: resolved };
        }
        if (SUPPORTED_VIDEO_EXTENSIONS.has(ext)) {
            return { type: 'video', filePath: resolved };
        }
        throw new ArgumentError(`Unsupported media format: ${ext}`, 'Supported formats: images (.jpg, .jpeg, .png, .webp) and videos (.mp4)');
    });
    return items;
}
function normalizePostMediaItems(kwargs) {
    const media = String(kwargs.media ?? '').trim();
    return validateMixedMediaItems(media.split(',').map((part) => part.trim()).filter(Boolean));
}
function validateInstagramPostArgs(kwargs) {
    const media = kwargs.media;
    if (media === undefined) {
        throw new ArgumentError('Argument "media" is required.', 'Provide --media /path/to/file.jpg or --media /path/a.jpg,/path/b.mp4');
    }
}
function isSafePrivateRouteFallbackError(error) {
    if (!(error instanceof CommandExecutionError))
        return false;
    return error.message.startsWith('Instagram private publish')
        || error.message.startsWith('Instagram private route');
}
function buildInstagramSuccessResult(mediaItems, url) {
    return [{
            status: '✅ Posted',
            detail: describePostDetail(mediaItems),
            url,
        }];
}
function buildFallbackHint(privateError, uiError) {
    const privateMessage = privateError instanceof Error ? privateError.message : String(privateError);
    const uiMessage = uiError instanceof Error ? uiError.message : String(uiError);
    return `Private route failed first: ${privateMessage}. UI fallback then failed: ${uiMessage}`;
}
async function executePrivateInstagramPost(input) {
    const privateConfig = await resolveInstagramPrivatePublishConfig(input.page);
    const privateResult = input.mediaItems.every((item) => item.type === 'image')
        ? await publishImagesViaPrivateApi({
            page: input.page,
            imagePaths: input.mediaItems.map((item) => item.filePath),
            caption: input.content,
            apiContext: privateConfig.apiContext,
            jazoest: privateConfig.jazoest,
        })
        : await publishMediaViaPrivateApi({
            page: input.page,
            mediaItems: input.mediaItems,
            caption: input.content,
            apiContext: privateConfig.apiContext,
            jazoest: privateConfig.jazoest,
        });
    const url = privateResult.code
        ? new URL(`/p/${privateResult.code}/`, INSTAGRAM_HOME_URL).toString()
        : await resolveLatestPostUrl(input.page, input.existingPostPaths);
    return buildInstagramSuccessResult(input.mediaItems, url);
}
async function executeUiInstagramPost(input) {
    let lastError;
    let lastSpecificCommandError = null;
    for (let attempt = 0; attempt < input.commandAttemptBudget; attempt++) {
        let shareClicked = false;
        try {
            await gotoInstagramHome(input.page, input.forceFreshStart || attempt > 0);
            await input.installProtocolCapture();
            await input.page.wait({ time: 2 });
            await dismissResidualDialogs(input.page);
            await ensureComposerOpen(input.page);
            const uploadSelectors = await resolveUploadSelectors(input.page, input.mediaItems);
            if (input.preUploadDelaySeconds > 0) {
                await input.page.wait({ time: input.preUploadDelaySeconds });
            }
            let uploaded = false;
            let uploadFailure = null;
            for (const selector of uploadSelectors) {
                let activeSelector = selector;
                for (let uploadAttempt = 0; uploadAttempt < input.uploadAttemptBudget; uploadAttempt++) {
                    await uploadMedia(input.page, input.mediaItems, activeSelector);
                    const uploadState = await waitForPreviewMaybe(input.page, input.previewProbeWindowSeconds);
                    if (uploadState.state === 'preview') {
                        uploaded = true;
                        break;
                    }
                    if (uploadState.state === 'failed') {
                        uploadFailure = makeUploadFailure(uploadState.detail);
                        for (let inlineRetry = 0; inlineRetry < input.inlineUploadRetryBudget; inlineRetry++) {
                            const clickedRetry = await clickVisibleUploadRetry(input.page);
                            if (!clickedRetry)
                                break;
                            await input.page.wait({ time: 3 });
                            const retriedState = await waitForPreviewMaybe(input.page, Math.max(3, Math.floor(input.previewProbeWindowSeconds / 2)));
                            if (retriedState.state === 'preview') {
                                uploaded = true;
                                break;
                            }
                            if (retriedState.state !== 'failed')
                                break;
                        }
                        if (uploaded)
                            break;
                        await dismissUploadErrorDialog(input.page);
                        await dismissResidualDialogs(input.page);
                        if (uploadAttempt < input.uploadAttemptBudget - 1) {
                            try {
                                await input.drainProtocolCapture();
                                await gotoInstagramHome(input.page, true);
                                await input.installProtocolCapture();
                                await input.page.wait({ time: 2 });
                                await dismissResidualDialogs(input.page);
                                await ensureComposerOpen(input.page);
                                activeSelector = await resolveFreshUploadSelector(input.page, activeSelector, input.mediaItems);
                                if (input.preUploadDelaySeconds > 0) {
                                    await input.page.wait({ time: input.preUploadDelaySeconds });
                                }
                            }
                            catch {
                                throw uploadFailure;
                            }
                            await input.page.wait({ time: 1.5 });
                            continue;
                        }
                        break;
                    }
                    break;
                }
                if (uploaded)
                    break;
            }
            if (!uploaded) {
                if (uploadFailure)
                    throw uploadFailure;
                await waitForPreview(input.page, input.finalPreviewWaitSeconds);
            }
            try {
                await advanceToCaptionEditor(input.page);
            }
            catch (error) {
                await rethrowUploadFailureIfPresent(input.page, error);
            }
            if (input.content) {
                await fillCaption(input.page, input.content);
                await ensureCaptionFilled(input.page, input.content);
            }
            if (input.preShareDelaySeconds > 0) {
                await input.page.wait({ time: input.preShareDelaySeconds });
            }
            await clickAction(input.page, ['Share', '分享'], 'caption');
            shareClicked = true;
            let url = '';
            try {
                url = await waitForPublishSuccess(input.page);
            }
            catch (error) {
                if (error instanceof CommandExecutionError
                    && error.message === 'Instagram post share failed'
                    && await clickVisibleShareRetry(input.page)) {
                    await input.page.wait({ time: Math.max(2, input.preShareDelaySeconds) });
                    url = await waitForPublishSuccess(input.page);
                }
                else {
                    throw error;
                }
            }
            await input.drainProtocolCapture();
            if (!url) {
                url = await resolveLatestPostUrl(input.page, input.existingPostPaths);
            }
            return buildInstagramSuccessResult(input.mediaItems, url);
        }
        catch (error) {
            lastError = error;
            if (error instanceof CommandExecutionError && error.message !== 'Failed to open Instagram post composer') {
                lastSpecificCommandError = error;
            }
            if (error instanceof AuthRequiredError)
                throw error;
            if (shareClicked) {
                throw error;
            }
            if (!(error instanceof CommandExecutionError) || attempt === input.commandAttemptBudget - 1) {
                if (error instanceof CommandExecutionError && error.message === 'Failed to open Instagram post composer' && lastSpecificCommandError) {
                    throw lastSpecificCommandError;
                }
                throw error;
            }
            let resetWindow = false;
            if (input.mediaItems.length >= 10 && input.page.closeWindow) {
                try {
                    await input.drainProtocolCapture();
                    await input.page.closeWindow();
                    resetWindow = true;
                }
                catch {
                    // Best-effort: a fresh automation window is safer than reusing a polluted one.
                }
            }
            if (!resetWindow) {
                await dismissResidualDialogs(input.page);
                await input.page.wait({ time: 1 });
            }
        }
    }
    throw lastError instanceof Error ? lastError : new CommandExecutionError('Instagram post failed');
}
async function ensureComposerOpen(page) {
    const result = await page.evaluate(buildEnsureComposerOpenJs());
    if (!result?.ok) {
        if (result?.reason === 'auth')
            throw new AuthRequiredError('www.instagram.com', 'Instagram login required before posting');
        throw new CommandExecutionError('Failed to open Instagram post composer');
    }
}
async function dismissResidualDialogs(page) {
    for (let attempt = 0; attempt < 4; attempt++) {
        const result = await page.evaluate(`
      (() => {
        const isVisible = (el) => {
          if (!(el instanceof HTMLElement)) return false;
          const style = window.getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          return style.display !== 'none'
            && style.visibility !== 'hidden'
            && rect.width > 0
            && rect.height > 0;
        };

        const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'))
          .filter((el) => el instanceof HTMLElement && isVisible(el));
        for (const dialog of dialogs) {
          const text = (dialog.textContent || '').replace(/\\s+/g, ' ').trim().toLowerCase();
          if (!text) continue;
          if (
            text.includes('post shared')
            || text.includes('your post has been shared')
            || text.includes('something went wrong')
            || text.includes('sharing')
            || text.includes('create new post')
            || text.includes('crop')
            || text.includes('edit')
          ) {
            const close = dialog.querySelector('[aria-label="Close"], button[aria-label="Close"], div[role="button"][aria-label="Close"]');
            if (close instanceof HTMLElement && isVisible(close)) {
              close.click();
              return { ok: true };
            }
            const closeByText = Array.from(dialog.querySelectorAll('button, div[role="button"]')).find((el) => {
              const buttonText = (el.textContent || '').replace(/\\s+/g, ' ').trim().toLowerCase();
              return isVisible(el) && (buttonText === 'close' || buttonText === 'cancel' || buttonText === '取消');
            });
            if (closeByText instanceof HTMLElement) {
              closeByText.click();
              return { ok: true };
            }
          }
        }

        return { ok: false };
      })()
    `);
        if (!result?.ok)
            return;
        await page.wait({ time: 0.5 });
    }
}
async function findUploadSelectors(page, mediaItems) {
    const includesVideo = mediaItems.some((item) => item.type === 'video');
    const result = await page.evaluate(`
    ((includesVideo) => {
      const isVisible = (el) => {
        if (!(el instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none'
          && style.visibility !== 'hidden'
          && rect.width > 0
          && rect.height > 0;
      };
      const hasButtonText = (root, labels) => {
        if (!root || !(root instanceof Element)) return false;
        return Array.from(root.querySelectorAll('button, div[role="button"], span'))
          .some((el) => {
            const text = (el.textContent || '').replace(/\\s+/g, ' ').trim().toLowerCase();
            return labels.some((label) => text === label.toLowerCase());
          });
      };

      const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
      const candidates = inputs.filter((el) => {
        if (!(el instanceof HTMLInputElement)) return false;
        if (el.disabled) return false;
        const accept = (el.getAttribute('accept') || '').toLowerCase();
        if (!accept) return true;
        if (includesVideo) return true;
        return accept.includes('image') || accept.includes('.jpg') || accept.includes('.jpeg') || accept.includes('.png') || accept.includes('.webp');
      });

      const dialogInputs = candidates.filter((el) => {
        const dialog = el.closest('[role="dialog"]');
        return hasButtonText(dialog, ['Select from computer', '从电脑中选择']);
      });

      const visibleDialogInputs = dialogInputs.filter((el) => {
        const dialog = el.closest('[role="dialog"]');
        return dialog instanceof HTMLElement && isVisible(dialog);
      });

      const pickerInputs = candidates.filter((el) => {
        return hasButtonText(el.parentElement, ['Select from computer', '从电脑中选择']);
      });

      const primary = visibleDialogInputs.length
        ? [visibleDialogInputs[visibleDialogInputs.length - 1]]
        : dialogInputs.length
          ? [dialogInputs[dialogInputs.length - 1]]
          : [];
      const ordered = [...primary, ...pickerInputs, ...candidates]
        .filter((el, index, arr) => arr.indexOf(el) === index);
      if (!ordered.length) return { ok: false };

      document.querySelectorAll('[data-opencli-ig-upload-index]').forEach((el) => el.removeAttribute('data-opencli-ig-upload-index'));
      const selectors = ordered.map((input, index) => {
        input.setAttribute('data-opencli-ig-upload-index', String(index));
        return '[data-opencli-ig-upload-index="' + index + '"]';
      });
      return { ok: true, selectors };
    })(${JSON.stringify(includesVideo)})
  `);
    if (!result?.ok || !result.selectors?.length) {
        throw new CommandExecutionError('Instagram upload input not found', 'Open the new-post composer in a logged-in browser session and retry');
    }
    return result.selectors;
}
async function resolveUploadSelectors(page, mediaItems) {
    try {
        return await findUploadSelectors(page, mediaItems);
    }
    catch (error) {
        if (!(error instanceof CommandExecutionError) || !error.message.includes('upload input not found')) {
            throw error;
        }
        await ensureComposerOpen(page);
        await page.wait({ time: 1.5 });
        try {
            return await findUploadSelectors(page, mediaItems);
        }
        catch (retryError) {
            if (!(retryError instanceof CommandExecutionError) || !retryError.message.includes('upload input not found')) {
                throw retryError;
            }
            await gotoInstagramHome(page, true);
            await page.wait({ time: 2 });
            await dismissResidualDialogs(page);
            await ensureComposerOpen(page);
            await page.wait({ time: 2 });
            return findUploadSelectors(page, mediaItems);
        }
    }
}
function extractSelectorIndex(selector) {
    const match = selector.match(/data-opencli-ig-upload-index="(\d+)"/);
    if (!match)
        return null;
    const index = Number.parseInt(match[1] || '', 10);
    return Number.isNaN(index) ? null : index;
}
async function resolveFreshUploadSelector(page, previousSelector, mediaItems) {
    const selectors = await resolveUploadSelectors(page, mediaItems);
    const index = extractSelectorIndex(previousSelector);
    if (index !== null && selectors[index])
        return selectors[index];
    return selectors[0] || previousSelector;
}
async function injectImageViaBrowser(page, imagePaths, selector) {
    const images = imagePaths.map((imagePath) => {
        const ext = path.extname(imagePath).toLowerCase();
        const mimeType = ext === '.png'
            ? 'image/png'
            : ext === '.webp'
                ? 'image/webp'
                : 'image/jpeg';
        return {
            name: path.basename(imagePath),
            type: mimeType,
            base64: fs.readFileSync(imagePath).toString('base64'),
        };
    });
    const chunkKey = `__opencliInstagramUpload_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const chunkSize = 256 * 1024;
    await page.evaluate(`
    (() => {
      window[${JSON.stringify(chunkKey)}] = [];
      return { ok: true };
    })()
  `);
    const payload = JSON.stringify(images);
    for (let offset = 0; offset < payload.length; offset += chunkSize) {
        const chunk = payload.slice(offset, offset + chunkSize);
        await page.evaluate(`
      (() => {
        const key = ${JSON.stringify(chunkKey)};
        const chunk = ${JSON.stringify(chunk)};
        const parts = Array.isArray(window[key]) ? window[key] : [];
        parts.push(chunk);
        window[key] = parts;
        return { ok: true, count: parts.length };
      })()
    `);
    }
    const result = await page.evaluate(`
    (() => {
      const selector = ${JSON.stringify(selector)};
      const key = ${JSON.stringify(chunkKey)};
      const payload = JSON.parse(Array.isArray(window[key]) ? window[key].join('') : '[]');

      const cleanup = () => { try { delete window[key]; } catch {} };
      const input = document.querySelector(selector);
      if (!(input instanceof HTMLInputElement)) {
        cleanup();
        return { ok: false, error: 'File input not found for fallback injection' };
      }

      try {
        const dt = new DataTransfer();
        for (const img of payload) {
          const binary = atob(img.base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          const blob = new Blob([bytes], { type: img.type });
          const file = new File([blob], img.name, { type: img.type });
          dt.items.add(file);
        }
        Object.defineProperty(input, 'files', { value: dt.files, configurable: true });
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new Event('input', { bubbles: true }));
        cleanup();
        return { ok: true, count: dt.files.length };
      } catch (error) {
        cleanup();
        return { ok: false, error: String(error) };
      }
    })()
  `);
    if (!result?.ok) {
        throw new CommandExecutionError(result?.error || 'Instagram fallback file injection failed');
    }
}
async function dispatchUploadEvents(page, selector) {
    await page.evaluate(`
    (() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      if (!(input instanceof HTMLInputElement)) return { ok: false };
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true };
    })()
  `);
}
export function buildInspectUploadStageJs() {
    return `
    (() => {
      const isVisible = (el) => {
        if (!(el instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none'
          && style.visibility !== 'hidden'
          && rect.width > 0
          && rect.height > 0;
      };
      const dialogs = Array.from(document.querySelectorAll('[role="dialog"]')).filter((el) => isVisible(el));
      const visibleTexts = dialogs.map((el) => (el.textContent || '').replace(/\\s+/g, ' ').trim());
      const dialogText = visibleTexts.join(' ');
      const combined = dialogText.toLowerCase();
      const hasVisibleButtonInDialogs = (labels) => {
        return dialogs.some((dialog) =>
          Array.from(dialog.querySelectorAll('button, div[role="button"]')).some((el) => {
            const text = (el.textContent || '').replace(/\\s+/g, ' ').trim();
            const aria = (el.getAttribute?.('aria-label') || '').replace(/\\s+/g, ' ').trim();
            return isVisible(el) && (labels.includes(text) || labels.includes(aria));
          })
        );
      };
      const hasCaption = dialogs.some((dialog) => !!dialog.querySelector('textarea, [contenteditable="true"]'));
      const hasPicker = hasVisibleButtonInDialogs(['Select from computer', '从电脑中选择']);
      const hasNext = hasVisibleButtonInDialogs(['Next', '下一步']);
      const hasPreviewUi = hasCaption
        || (!hasPicker && hasNext)
        || /crop|select crop|select zoom|open media gallery|filters|adjustments|裁剪|缩放|滤镜|调整/.test(combined);
      const failed = /something went wrong|please try again|couldn['’]t upload|could not upload|upload failed|try again|出错|失败/.test(combined);
      if (hasPreviewUi) return { state: 'preview', detail: dialogText || '' };
      if (failed) return { state: 'failed', detail: dialogText || 'Something went wrong' };
      return { state: 'pending', detail: dialogText || '' };
    })()
  `;
}
async function inspectUploadStage(page) {
    const result = await page.evaluate(buildInspectUploadStageJs());
    if (result?.state)
        return result;
    if (result?.ok === true)
        return { state: 'preview', detail: result.detail };
    return { state: 'pending', detail: result?.detail };
}
function makeUploadFailure(detail) {
    return new CommandExecutionError('Instagram image upload failed', detail ? `Instagram rejected the upload: ${detail}` : 'Instagram rejected the upload before the preview stage');
}
async function uploadMedia(page, mediaItems, selector) {
    const mediaPaths = mediaItems.map((item) => item.filePath);
    if (!page.setFileInput) {
        throw new CommandExecutionError('Instagram posting requires Browser Bridge file upload support', 'Use Browser Bridge or another browser mode that supports setFileInput');
    }
    let activeSelector = selector;
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            await page.setFileInput(mediaPaths, activeSelector);
            await dispatchUploadEvents(page, activeSelector);
            return;
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const staleSelector = message.includes('No element found matching selector')
                || message.includes('Could not find node with given id')
                || message.includes('No node with given id found');
            if (staleSelector && attempt === 0) {
                activeSelector = await resolveFreshUploadSelector(page, activeSelector, mediaItems);
                continue;
            }
            if (!message.includes('Unknown action') && !message.includes('set-file-input') && !message.includes('not supported')) {
                throw error;
            }
            if (mediaItems.some((item) => item.type === 'video')) {
                throw new CommandExecutionError('Instagram mixed-media posting requires Browser Bridge file upload support', 'Use Browser Bridge or another browser mode that supports setFileInput for image/video uploads');
            }
            await injectImageViaBrowser(page, mediaPaths, activeSelector);
            return;
        }
    }
}
function describePostDetail(mediaItems) {
    if (mediaItems.every((item) => item.type === 'image')) {
        return mediaItems.length === 1
            ? 'Single image post shared successfully'
            : `${mediaItems.length}-image carousel post shared successfully`;
    }
    return mediaItems.length === 1
        ? 'Single mixed-media post shared successfully'
        : `${mediaItems.length}-item mixed-media carousel post shared successfully`;
}
function getCommandAttemptBudget(mediaItems) {
    if (mediaItems.length >= 10)
        return 6;
    if (mediaItems.length >= 5)
        return 4;
    return 3;
}
function getPreUploadDelaySeconds(mediaItems) {
    if (mediaItems.length >= 10)
        return 3;
    if (mediaItems.length >= 5)
        return 1.5;
    return 0;
}
function getUploadAttemptBudget(mediaItems) {
    if (mediaItems.length >= 10)
        return 3;
    if (mediaItems.length >= 5)
        return 3;
    return 2;
}
function getPreviewProbeWindowSeconds(mediaItems) {
    if (mediaItems.length >= 10)
        return 6;
    if (mediaItems.length >= 5)
        return 6;
    return 4;
}
function getFinalPreviewWaitSeconds(mediaItems) {
    if (mediaItems.length >= 10)
        return 12;
    if (mediaItems.length >= 5)
        return 16;
    return 12;
}
function getPreShareDelaySeconds(mediaItems) {
    if (mediaItems.length >= 10)
        return 4;
    if (mediaItems.length >= 5)
        return 3;
    return 0;
}
function getInlineUploadRetryBudget(mediaItems) {
    if (mediaItems.length >= 10)
        return 3;
    if (mediaItems.length >= 5)
        return 2;
    return 1;
}
async function dismissUploadErrorDialog(page) {
    const result = await page.evaluate(`
    (() => {
      const isVisible = (el) => {
        if (!(el instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none'
          && style.visibility !== 'hidden'
          && rect.width > 0
          && rect.height > 0;
      };
      const dialogs = Array.from(document.querySelectorAll('[role="dialog"]')).filter((el) => isVisible(el));
      for (const dialog of dialogs) {
        const text = (dialog.textContent || '').replace(/\\s+/g, ' ').trim().toLowerCase();
        if (!text.includes('something went wrong') && !text.includes('try again') && !text.includes('失败') && !text.includes('出错')) continue;
        const close = dialog.querySelector('[aria-label="Close"], button[aria-label="Close"], div[role="button"][aria-label="Close"]');
        if (close instanceof HTMLElement && isVisible(close)) {
          close.click();
          return { ok: true };
        }
      }
      return { ok: false };
    })()
  `);
    return !!result?.ok;
}
async function clickVisibleUploadRetry(page) {
    const result = await page.evaluate(`
    (() => {
      const isVisible = (el) => {
        if (!(el instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none'
          && style.visibility !== 'hidden'
          && rect.width > 0
          && rect.height > 0;
      };
      const dialogs = Array.from(document.querySelectorAll('[role="dialog"]')).filter((el) => isVisible(el));
      for (const dialog of dialogs) {
        const text = (dialog.textContent || '').replace(/\\s+/g, ' ').trim().toLowerCase();
        if (!text.includes('something went wrong') && !text.includes('try again') && !text.includes('失败') && !text.includes('出错')) continue;
        const retry = Array.from(dialog.querySelectorAll('button, div[role="button"]')).find((el) => {
          const label = ((el.textContent || '') + ' ' + (el.getAttribute?.('aria-label') || ''))
            .replace(/\\s+/g, ' ')
            .trim()
            .toLowerCase();
          return isVisible(el) && (
            label === 'try again'
            || label === 'retry'
            || label === '再试一次'
            || label === '重试'
          );
        });
        if (retry instanceof HTMLElement) {
          retry.click();
          return { ok: true };
        }
      }
      return { ok: false };
    })()
  `);
    return !!result?.ok;
}
async function waitForPreview(page, maxWaitSeconds = 12) {
    const attempts = Math.max(1, Math.ceil(maxWaitSeconds));
    for (let attempt = 0; attempt < attempts; attempt++) {
        const state = await inspectUploadStage(page);
        if (state.state === 'preview')
            return;
        if (state.state === 'failed') {
            await page.screenshot({ path: '/tmp/instagram_post_preview_debug.png' });
            throw makeUploadFailure('Inspect /tmp/instagram_post_preview_debug.png. ' + (state.detail || ''));
        }
        if (attempt < attempts - 1)
            await page.wait({ time: 1 });
    }
    await page.screenshot({ path: '/tmp/instagram_post_preview_debug.png' });
    throw new CommandExecutionError('Instagram image preview did not appear after upload', 'The selected file input may not match the active composer; inspect /tmp/instagram_post_preview_debug.png');
}
async function waitForPreviewMaybe(page, maxWaitSeconds = 4) {
    const attempts = Math.max(1, Math.ceil(maxWaitSeconds * 2));
    for (let attempt = 0; attempt < attempts; attempt++) {
        const state = await inspectUploadStage(page);
        if (state.state !== 'pending')
            return state;
        if (attempt < attempts - 1)
            await page.wait({ time: 0.5 });
    }
    return { state: 'pending' };
}
export function buildClickActionJs(labels, scope = 'any') {
    return `
    ((labels, scope) => {
      const isVisible = (el) => {
        if (!(el instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none'
          && style.visibility !== 'hidden'
          && rect.width > 0
          && rect.height > 0;
      };

      const matchesScope = (dialog) => {
        if (!(dialog instanceof HTMLElement) || !isVisible(dialog)) return false;
        const text = (dialog.textContent || '').replace(/\\s+/g, ' ').trim().toLowerCase();
        if (scope === 'caption') {
          return !!dialog.querySelector('textarea, [contenteditable="true"]')
            || text.includes('write a caption')
            || text.includes('add location')
            || text.includes('add collaborators')
            || text.includes('accessibility')
            || text.includes('advanced settings');
        }
        if (scope === 'media') {
          return !!dialog.querySelector('input[type="file"]')
            || text.includes('select from computer')
            || text.includes('crop')
            || text.includes('filters')
            || text.includes('adjustments')
            || text.includes('open media gallery')
            || text.includes('select crop')
            || text.includes('select zoom');
        }
        return true;
      };

      const containers = scope !== 'any'
        ? Array.from(document.querySelectorAll('[role="dialog"]')).filter(matchesScope)
        : [document.body];

      for (const container of containers) {
        const nodes = Array.from(container.querySelectorAll('button, div[role="button"]'));
        for (const node of nodes) {
          const text = (node.textContent || '').replace(/\\s+/g, ' ').trim();
          const aria = (node.getAttribute?.('aria-label') || '').replace(/\\s+/g, ' ').trim();
          if (!text && !aria) continue;
          if (!labels.includes(text) && !labels.includes(aria)) continue;
          if (node instanceof HTMLElement && isVisible(node) && node.getAttribute('aria-disabled') !== 'true') {
            node.click();
            return { ok: true, label: text || aria };
          }
        }
      }
      return { ok: false };
    })(${JSON.stringify(labels)}, ${JSON.stringify(scope)})
  `;
}
async function clickAction(page, labels, scope = 'any') {
    const result = await page.evaluate(buildClickActionJs(labels, scope));
    if (!result?.ok) {
        throw new CommandExecutionError(`Instagram action button not found: ${labels.join(' / ')}`);
    }
    return result.label || labels[0];
}
async function clickVisibleShareRetry(page) {
    const result = await page.evaluate(`
    (() => {
      const isVisible = (el) => {
        if (!(el instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none'
          && style.visibility !== 'hidden'
          && rect.width > 0
          && rect.height > 0;
      };

      const dialogs = Array.from(document.querySelectorAll('[role="dialog"]')).filter((el) => isVisible(el));
      for (const dialog of dialogs) {
        const text = (dialog.textContent || '').replace(/\\s+/g, ' ').trim().toLowerCase();
        if (!text.includes('post couldn') && !text.includes('could not be shared') && !text.includes('share failed')) continue;

        const retry = Array.from(dialog.querySelectorAll('button, div[role="button"]')).find((el) => {
          const label = ((el.textContent || '') + ' ' + (el.getAttribute?.('aria-label') || ''))
            .replace(/\\s+/g, ' ')
            .trim()
            .toLowerCase();
          return isVisible(el) && (
            label === 'try again'
            || label === 'retry'
            || label === '再试一次'
            || label === '重试'
          );
        });

        if (retry instanceof HTMLElement) {
          retry.click();
          return { ok: true };
        }
      }

      return { ok: false };
    })()
  `);
    return !!result?.ok;
}
async function hasCaptionEditor(page) {
    const result = await page.evaluate(`
    (() => {
      const editable = document.querySelector('textarea, [contenteditable="true"]');
      return { ok: !!editable };
    })()
  `);
    return !!result?.ok;
}
async function isCaptionStage(page) {
    const result = await page.evaluate(`
    (() => {
      const editable = document.querySelector('textarea, [contenteditable="true"]');
      const dialogText = Array.from(document.querySelectorAll('[role="dialog"]'))
        .map((el) => (el.textContent || '').replace(/\\s+/g, ' ').trim().toLowerCase())
        .join(' ');
      return {
        ok: !!editable
          || dialogText.includes('write a caption')
          || dialogText.includes('add location')
          || dialogText.includes('add collaborators')
          || dialogText.includes('advanced settings'),
      };
    })()
  `);
    return !!result?.ok;
}
async function advanceToCaptionEditor(page) {
    for (let attempt = 0; attempt < 3; attempt++) {
        if (await isCaptionStage(page)) {
            return;
        }
        try {
            await clickAction(page, ['Next', '下一步'], 'media');
        }
        catch (error) {
            if (error instanceof CommandExecutionError) {
                await page.wait({ time: 1.5 });
                if (await isCaptionStage(page)) {
                    return;
                }
                const uploadState = await inspectUploadStage(page);
                if (uploadState.state === 'failed') {
                    throw makeUploadFailure(uploadState.detail);
                }
                if (attempt < 2) {
                    continue;
                }
            }
            throw error;
        }
        await page.wait({ time: 1.5 });
        if (await hasCaptionEditor(page)) {
            return;
        }
        const uploadState = await inspectUploadStage(page);
        if (uploadState.state === 'failed') {
            throw makeUploadFailure(uploadState.detail);
        }
    }
    await page.screenshot({ path: '/tmp/instagram_post_caption_debug.png' });
    throw new CommandExecutionError('Instagram caption editor did not appear', 'Instagram may have changed the publish flow; inspect /tmp/instagram_post_caption_debug.png');
}
async function waitForCaptionEditor(page) {
    if (!(await hasCaptionEditor(page))) {
        await page.screenshot({ path: '/tmp/instagram_post_caption_debug.png' });
        throw new CommandExecutionError('Instagram caption editor did not appear', 'Instagram may have changed the publish flow; inspect /tmp/instagram_post_caption_debug.png');
    }
}
async function rethrowUploadFailureIfPresent(page, originalError) {
    const uploadState = await inspectUploadStage(page);
    if (uploadState.state === 'failed') {
        throw makeUploadFailure(uploadState.detail);
    }
    throw originalError;
}
async function focusCaptionEditorForNativeInsert(page) {
    const result = await page.evaluate(`
    (() => {
      const textarea = document.querySelector('[aria-label="Write a caption..."], textarea');
      if (textarea instanceof HTMLTextAreaElement) {
        textarea.focus();
        textarea.select();
        return { ok: true, kind: 'textarea' };
      }

      const editor = document.querySelector('[aria-label="Write a caption..."][contenteditable="true"]')
        || document.querySelector('[contenteditable="true"]');
      if (!(editor instanceof HTMLElement)) return { ok: false };

      const lexical = editor.__lexicalEditor;
      try {
        if (lexical && typeof lexical.getEditorState === 'function' && typeof lexical.parseEditorState === 'function') {
          const emptyState = {
            root: {
              children: [{
                children: [],
                direction: null,
                format: '',
                indent: 0,
                textFormat: 0,
                textStyle: '',
                type: 'paragraph',
                version: 1,
              }],
              direction: null,
              format: '',
              indent: 0,
              type: 'root',
              version: 1,
            },
          };
          const nextState = lexical.parseEditorState(JSON.stringify(emptyState));
          try {
            lexical.setEditorState(nextState, { tag: 'history-merge', discrete: true });
          } catch {
            lexical.setEditorState(nextState);
          }
        } else {
          editor.textContent = '';
        }
      } catch {
        editor.textContent = '';
      }

      editor.focus();
      const selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
        const range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
        selection.addRange(range);
      }

      return { ok: true, kind: 'contenteditable' };
    })()
  `);
    return !!result?.ok;
}
async function fillCaption(page, content) {
    if (page.insertText && await focusCaptionEditorForNativeInsert(page)) {
        try {
            await page.insertText(content);
            await page.wait({ time: 0.3 });
            await page.evaluate(`
        (() => {
          const textarea = document.querySelector('[aria-label="Write a caption..."], textarea');
          if (textarea instanceof HTMLTextAreaElement) {
            textarea.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText' }));
            textarea.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
            textarea.blur();
            return { ok: true };
          }

          const editor = document.querySelector('[aria-label="Write a caption..."][contenteditable="true"]')
            || document.querySelector('[contenteditable="true"]');
          if (!(editor instanceof HTMLElement)) return { ok: false };
          try {
            editor.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText' }));
          } catch {
            editor.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
          }
          editor.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
          editor.blur();
          return { ok: true };
        })()
      `);
            return;
        }
        catch {
            // Fall back to browser-side editor manipulation below.
        }
    }
    const result = await page.evaluate(`
    ((content) => {
      const createParagraph = (text) => ({
        children: text
          ? [{ detail: 0, format: 0, mode: 'normal', style: '', text, type: 'text', version: 1 }]
          : [],
        direction: null,
        format: '',
        indent: 0,
        textFormat: 0,
        textStyle: '',
        type: 'paragraph',
        version: 1,
      });

      const textarea = document.querySelector('[aria-label="Write a caption..."], textarea');
      if (textarea instanceof HTMLTextAreaElement) {
        textarea.focus();
        const dt = new DataTransfer();
        dt.setData('text/plain', content);
        textarea.dispatchEvent(new ClipboardEvent('paste', {
          clipboardData: dt,
          bubbles: true,
          cancelable: true,
        }));
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        setter?.call(textarea, content);
        textarea.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        return { ok: true, mode: 'textarea' };
      }

      const editor = document.querySelector('[aria-label="Write a caption..."][contenteditable="true"]')
        || document.querySelector('[contenteditable="true"]');
      if (editor instanceof HTMLElement) {
        editor.focus();
        const lexical = editor.__lexicalEditor;
        if (lexical && typeof lexical.getEditorState === 'function' && typeof lexical.parseEditorState === 'function') {
          const currentState = lexical.getEditorState && lexical.getEditorState();
          const base = currentState && typeof currentState.toJSON === 'function' ? currentState.toJSON() : {};
          const lines = String(content).split(/\\r?\\n/);
          const paragraphs = lines.map((line) => createParagraph(line));
          base.root = {
            children: paragraphs.length ? paragraphs : [createParagraph('')],
            direction: null,
            format: '',
            indent: 0,
            type: 'root',
            version: 1,
          };

          const nextState = lexical.parseEditorState(JSON.stringify(base));
          try {
            lexical.setEditorState(nextState, { tag: 'history-merge', discrete: true });
          } catch {
            lexical.setEditorState(nextState);
          }

          editor.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
          editor.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
          const nextCurrentState = lexical.getEditorState && lexical.getEditorState();
          const pendingState = lexical._pendingEditorState;
          return {
            ok: true,
            mode: 'lexical',
            value: editor.textContent || '',
            current: nextCurrentState && typeof nextCurrentState.toJSON === 'function' ? nextCurrentState.toJSON() : null,
            pending: pendingState && typeof pendingState.toJSON === 'function' ? pendingState.toJSON() : null,
          };
        }

        const selection = window.getSelection();
        if (selection) {
          selection.removeAllRanges();
          const range = document.createRange();
          range.selectNodeContents(editor);
          selection.addRange(range);
        }
        const dt = new DataTransfer();
        dt.setData('text/plain', content);
        editor.dispatchEvent(new ClipboardEvent('paste', {
          clipboardData: dt,
          bubbles: true,
          cancelable: true,
        }));
        return { ok: true, mode: 'contenteditable', value: editor.textContent || '' };
      }

      return { ok: false };
    })(${JSON.stringify(content)})
  `);
    if (!result?.ok) {
        throw new CommandExecutionError('Failed to fill Instagram caption');
    }
}
async function captionMatches(page, content) {
    const result = await page.evaluate(`
    ((content) => {
      const normalized = content.trim();
      const readLexicalText = (node) => {
        if (!node || typeof node !== 'object') return '';
        if (node.type === 'text' && typeof node.text === 'string') return node.text;
        if (!Array.isArray(node.children)) return '';
        if (node.type === 'root') {
          return node.children.map((child) => readLexicalText(child)).join('\\n');
        }
        if (node.type === 'paragraph') {
          return node.children.map((child) => readLexicalText(child)).join('');
        }
        return node.children.map((child) => readLexicalText(child)).join('');
      };

      const textarea = document.querySelector('[aria-label="Write a caption..."], textarea');
      if (textarea instanceof HTMLTextAreaElement) {
        return { ok: textarea.value.trim() === normalized };
      }

      const editor = document.querySelector('[aria-label="Write a caption..."][contenteditable="true"]')
        || document.querySelector('[contenteditable="true"]');
      if (editor instanceof HTMLElement) {
        const lexical = editor.__lexicalEditor;
        if (lexical && typeof lexical.getEditorState === 'function') {
          const currentState = lexical.getEditorState();
          const pendingState = lexical._pendingEditorState;
          const current = currentState && typeof currentState.toJSON === 'function' ? currentState.toJSON() : null;
          const pending = pendingState && typeof pendingState.toJSON === 'function' ? pendingState.toJSON() : null;
          const currentText = readLexicalText(current && current.root).trim();
          const pendingText = readLexicalText(pending && pending.root).trim();
          if (currentText === normalized || pendingText === normalized) {
            return { ok: true, currentText, pendingText };
          }
        }

        const text = (editor.textContent || '').replace(/\\u00a0/g, ' ').trim();
        if (text === normalized) return { ok: true };

        const counters = Array.from(document.querySelectorAll('div, span'))
          .map((el) => (el.textContent || '').replace(/\\s+/g, ' ').trim())
          .filter(Boolean);
        const counter = counters.find((value) => /\\d+\\s*\\/\\s*2,?200/.test(value));
        if (counter) {
          const match = counter.match(/(\\d+)\\s*\\/\\s*2,?200/);
          if (match && Number(match[1]) >= normalized.length) return { ok: true };
        }

        return { ok: false, text, counter: counter || '' };
      }

      return { ok: false };
    })(${JSON.stringify(content)})
  `);
    return !!result?.ok;
}
async function ensureCaptionFilled(page, content) {
    for (let attempt = 0; attempt < 6; attempt++) {
        if (await captionMatches(page, content)) {
            return;
        }
        if (attempt < 5) {
            await page.wait({ time: 0.5 });
        }
    }
    await page.screenshot({ path: '/tmp/instagram_post_caption_fill_debug.png' });
    throw new CommandExecutionError('Instagram caption did not stick before sharing', 'Inspect /tmp/instagram_post_caption_fill_debug.png for the caption editor state');
}
async function waitForPublishSuccess(page) {
    let settledStreak = 0;
    for (let attempt = 0; attempt < 90; attempt++) {
        const result = await page.evaluate(buildPublishStatusProbeJs());
        if (result?.failed) {
            await page.screenshot({ path: '/tmp/instagram_post_share_debug.png' });
            throw new CommandExecutionError('Instagram post share failed', 'Inspect /tmp/instagram_post_share_debug.png for the share failure state');
        }
        if (result?.ok) {
            return result.url || '';
        }
        if (result?.settled) {
            settledStreak += 1;
            if (settledStreak >= 3)
                return '';
        }
        else {
            settledStreak = 0;
        }
        if (attempt < 89) {
            await page.wait({ time: 1 });
        }
    }
    await page.screenshot({ path: '/tmp/instagram_post_share_debug.png' });
    throw new CommandExecutionError('Instagram post share confirmation did not appear', 'Inspect /tmp/instagram_post_share_debug.png for the final publish state');
}
async function resolveCurrentUserId(page) {
    const cookies = await page.getCookies({ domain: 'instagram.com' });
    return cookies.find((cookie) => cookie.name === 'ds_user_id')?.value || '';
}
async function resolveProfileUrl(page, currentUserId = '') {
    if (currentUserId) {
        const runtimeInfo = await resolveInstagramRuntimeInfo(page);
        const apiResult = await page.evaluate(`
      (async () => {
        const userId = ${JSON.stringify(currentUserId)};
        const appId = ${JSON.stringify(runtimeInfo.appId || '')};
        try {
          const res = await fetch(
            'https://www.instagram.com/api/v1/users/' + encodeURIComponent(userId) + '/info/',
            {
              credentials: 'include',
              headers: appId ? { 'X-IG-App-ID': appId } : {},
            },
          );
          if (!res.ok) return { ok: false };
          const data = await res.json();
          const username = data?.user?.username || '';
          return { ok: !!username, username };
        } catch {
          return { ok: false };
        }
      })()
    `);
        if (apiResult?.ok && apiResult.username) {
            return new URL(`/${apiResult.username}/`, INSTAGRAM_HOME_URL).toString();
        }
    }
    const result = await page.evaluate(`
    (() => {
      const isVisible = (el) => {
        if (!(el instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none'
          && style.visibility !== 'hidden'
          && rect.width > 0
          && rect.height > 0;
      };

      const anchors = Array.from(document.querySelectorAll('a[href]'))
        .filter((el) => el instanceof HTMLAnchorElement && isVisible(el))
        .map((el) => ({
          href: el.getAttribute('href') || '',
          text: (el.textContent || '').replace(/\\s+/g, ' ').trim().toLowerCase(),
          aria: (el.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim().toLowerCase(),
        }))
        .filter((el) => /^\\/[^/?#]+\\/$/.test(el.href));

      const explicitProfile = anchors.find((el) => el.text === 'profile' || el.aria === 'profile')?.href || '';
      const path = explicitProfile;
      return { ok: !!path, path };
    })()
  `);
    if (!result?.ok || !result.path)
        return '';
    return new URL(result.path, INSTAGRAM_HOME_URL).toString();
}
async function collectVisibleProfilePostPaths(page) {
    const result = await page.evaluate(`
    (() => {
      const isVisible = (el) => {
        if (!(el instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none'
          && style.visibility !== 'hidden'
          && rect.width > 0
          && rect.height > 0;
      };

      const hrefs = Array.from(document.querySelectorAll('a[href*="/p/"]'))
        .filter((el) => el instanceof HTMLAnchorElement && isVisible(el))
        .map((el) => el.getAttribute('href') || '')
        .filter((href) => /^\\/(?:[^/?#]+\\/)?p\\/[^/?#]+\\/?$/.test(href))
        .filter((href, index, arr) => arr.indexOf(href) === index);

      return { ok: hrefs.length > 0, hrefs };
    })()
  `);
    return Array.isArray(result?.hrefs) ? result.hrefs.filter(Boolean) : [];
}
async function captureExistingProfilePostPaths(page) {
    const currentUserId = await resolveCurrentUserId(page);
    if (!currentUserId)
        return new Set();
    const profileUrl = await resolveProfileUrl(page, currentUserId);
    if (!profileUrl)
        return new Set();
    try {
        await page.goto(profileUrl);
        await page.wait({ time: 3 });
        return new Set(await collectVisibleProfilePostPaths(page));
    }
    catch {
        return new Set();
    }
}
async function resolveLatestPostUrl(page, existingPostPaths) {
    const currentUrl = await page.getCurrentUrl?.();
    if (currentUrl && /\/p\//.test(currentUrl))
        return currentUrl;
    const currentUserId = await resolveCurrentUserId(page);
    const profileUrl = await resolveProfileUrl(page, currentUserId);
    if (!profileUrl)
        return '';
    await page.goto(profileUrl);
    await page.wait({ time: 4 });
    for (let attempt = 0; attempt < 8; attempt++) {
        const hrefs = await collectVisibleProfilePostPaths(page);
        const href = hrefs.find((candidate) => !existingPostPaths.has(candidate)) || '';
        if (href) {
            return new URL(href, INSTAGRAM_HOME_URL).toString();
        }
        if (attempt < 7)
            await page.wait({ time: 1 });
    }
    return '';
}
cli({
    site: 'instagram',
    name: 'post',
    access: 'write',
    description: 'Post an Instagram feed image or mixed-media carousel',
    domain: 'www.instagram.com',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'media', required: false, valueRequired: true, help: `Comma-separated media paths (images/videos, up to ${MAX_MEDIA_ITEMS})` },
        { name: 'content', positional: true, required: false, help: 'Caption text' },
        { name: 'timeout', type: 'int', required: false, default: 300, help: 'Max seconds for the overall command (default: 300)' },
    ],
    columns: ['status', 'detail', 'url'],
    validateArgs: validateInstagramPostArgs,
    func: async (page, kwargs) => {
        const browserPage = requirePage(page);
        const mediaItems = normalizePostMediaItems(kwargs);
        const content = String(kwargs.content ?? '').trim();
        const existingPostPaths = await captureExistingProfilePostPaths(browserPage);
        const commandAttemptBudget = getCommandAttemptBudget(mediaItems);
        const preUploadDelaySeconds = getPreUploadDelaySeconds(mediaItems);
        const uploadAttemptBudget = getUploadAttemptBudget(mediaItems);
        const previewProbeWindowSeconds = getPreviewProbeWindowSeconds(mediaItems);
        const finalPreviewWaitSeconds = getFinalPreviewWaitSeconds(mediaItems);
        const preShareDelaySeconds = getPreShareDelaySeconds(mediaItems);
        const inlineUploadRetryBudget = getInlineUploadRetryBudget(mediaItems);
        const protocolCaptureEnabled = process.env.OPENCLI_INSTAGRAM_CAPTURE === '1';
        const protocolCaptureData = [];
        const protocolCaptureErrors = [];
        const installProtocolCapture = async () => {
            if (!protocolCaptureEnabled)
                return;
            await installInstagramProtocolCapture(browserPage);
        };
        const drainProtocolCapture = async () => {
            if (!protocolCaptureEnabled)
                return;
            const payload = await readInstagramProtocolCapture(browserPage);
            if (payload.data.length)
                protocolCaptureData.push(...payload.data);
            if (payload.errors.length)
                protocolCaptureErrors.push(...payload.errors);
        };
        try {
            try {
                return await executePrivateInstagramPost({
                    page: browserPage,
                    mediaItems,
                    content,
                    existingPostPaths,
                });
            }
            catch (error) {
                if (error instanceof AuthRequiredError || !isSafePrivateRouteFallbackError(error)) {
                    throw error;
                }
                try {
                    return await executeUiInstagramPost({
                        page: browserPage,
                        mediaItems,
                        content,
                        existingPostPaths,
                        commandAttemptBudget,
                        preUploadDelaySeconds,
                        uploadAttemptBudget,
                        previewProbeWindowSeconds,
                        finalPreviewWaitSeconds,
                        preShareDelaySeconds,
                        inlineUploadRetryBudget,
                        installProtocolCapture,
                        drainProtocolCapture,
                        forceFreshStart: true,
                    });
                }
                catch (uiError) {
                    if (uiError instanceof AuthRequiredError)
                        throw uiError;
                    if (uiError instanceof CommandExecutionError) {
                        throw new CommandExecutionError(uiError.message, buildFallbackHint(error, uiError));
                    }
                    throw uiError;
                }
            }
        }
        finally {
            if (protocolCaptureEnabled) {
                try {
                    await drainProtocolCapture();
                }
                catch {
                    // Best-effort: capture export should not hide the main command result.
                }
                fs.writeFileSync(INSTAGRAM_PROTOCOL_TRACE_OUTPUT_PATH, JSON.stringify({
                    data: protocolCaptureData,
                    errors: protocolCaptureErrors,
                }, null, 2));
            }
        }
    },
});
