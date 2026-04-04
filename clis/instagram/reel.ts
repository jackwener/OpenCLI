import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { Page as BrowserPage } from '../../browser/page.js';
import { cli, Strategy } from '../../registry.js';
import { ArgumentError, AuthRequiredError, CommandExecutionError } from '../../errors.js';
import type { BrowserCookie, IPage } from '../../types.js';
import {
  buildClickActionJs,
  buildEnsureComposerOpenJs,
  buildInspectUploadStageJs,
} from './post.js';
import { resolveInstagramRuntimeInfo } from './_shared/runtime-info.js';

const INSTAGRAM_HOME_URL = 'https://www.instagram.com/';
const SUPPORTED_VIDEO_EXTENSIONS = new Set(['.mp4']);
const INSTAGRAM_REEL_TIMEOUT_SECONDS = 600;

type InstagramReelSuccessRow = {
  status: string;
  detail: string;
  url: string;
};

type ReelStageState = {
  state: 'crop' | 'edit' | 'composer' | 'failed' | 'pending';
  detail?: string;
};

type PreparedVideoUpload = {
  originalPath: string;
  uploadPath: string;
  cleanupPath?: string;
};

function requirePage(page: IPage | null): IPage {
  if (!page) throw new CommandExecutionError('Browser session required for instagram reel');
  return page;
}

async function gotoInstagramHome(page: IPage, forceReload = false): Promise<void> {
  if (forceReload) {
    await page.goto(`${INSTAGRAM_HOME_URL}?__opencli_reset=${Date.now()}`);
    await page.wait({ time: 1 });
  }
  await page.goto(INSTAGRAM_HOME_URL);
}

function validateVideoPath(input: unknown): string {
  const resolved = path.resolve(String(input || '').trim());
  if (!resolved) {
    throw new ArgumentError('Video path cannot be empty');
  }
  if (!fs.existsSync(resolved)) {
    throw new ArgumentError(`Video file not found: ${resolved}`);
  }
  const ext = path.extname(resolved).toLowerCase();
  if (!SUPPORTED_VIDEO_EXTENSIONS.has(ext)) {
    throw new ArgumentError(`Unsupported video format: ${ext}`, 'Supported formats: .mp4');
  }
  return resolved;
}

function validateInstagramReelArgs(kwargs: Record<string, unknown>): void {
  if (kwargs.video === undefined) {
    throw new ArgumentError(
      'Argument "video" is required.',
      'Provide --video /path/to/file.mp4',
    );
  }
}

function buildInstagramReelSuccessResult(url: string): InstagramReelSuccessRow[] {
  return [{
    status: '✅ Posted',
    detail: 'Single reel shared successfully',
    url,
  }];
}

function isRecoverableReelSessionError(error: unknown): boolean {
  if (!(error instanceof CommandExecutionError)) return false;
  return error.message === 'Instagram reel upload input not found'
    || error.message === 'Instagram reel preview did not appear after upload'
    || error.message === 'Instagram reel upload failed';
}

function buildSafeTempVideoPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase() || '.mp4';
  return path.join(os.tmpdir(), `opencli-instagram-video-real${ext}`);
}

function prepareVideoUpload(filePath: string): PreparedVideoUpload {
  const baseName = path.basename(filePath);
  if (/^[a-zA-Z0-9._-]+$/.test(baseName)) {
    return { originalPath: filePath, uploadPath: filePath };
  }
  const uploadPath = buildSafeTempVideoPath(filePath);
  fs.copyFileSync(filePath, uploadPath);
  return {
    originalPath: filePath,
    uploadPath,
    cleanupPath: uploadPath,
  };
}

async function ensureComposerOpen(page: IPage): Promise<void> {
  const result = await page.evaluate(buildEnsureComposerOpenJs()) as { ok?: boolean; reason?: string };
  if (!result?.ok) {
    if (result?.reason === 'auth') {
      throw new AuthRequiredError('www.instagram.com', 'Instagram login required before posting a reel');
    }
    throw new CommandExecutionError('Failed to open Instagram reel composer');
  }
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const ready = await page.evaluate(`
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
        const inputs = Array.from(document.querySelectorAll('input[type="file"]'))
          .filter((el) => el instanceof HTMLInputElement)
          .filter((el) => {
            const dialog = el.closest('[role="dialog"]');
            return dialog instanceof HTMLElement && isVisible(dialog);
          });
        return { ok: inputs.length > 0 };
      })()
    `) as { ok?: boolean };
    if (ready?.ok) return;
    if (attempt < 11) await page.wait({ time: 0.5 });
  }
  throw new CommandExecutionError('Instagram reel upload input not found', 'Open the new-post composer in a logged-in browser session and retry');
}

async function dismissResidualDialogs(page: IPage): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
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
            || text.includes('your reel has been shared')
            || text.includes('video posts are now reels')
            || text.includes('something went wrong')
            || text.includes('sharing')
            || text.includes('create new post')
            || text.includes('new reel')
            || text.includes('crop')
            || text.includes('edit')
          ) {
            const close = dialog.querySelector('[aria-label="Close"], button[aria-label="Close"], div[role="button"][aria-label="Close"]');
            if (close instanceof HTMLElement && isVisible(close)) {
              close.click();
              return { ok: true };
            }
          }
        }
        return { ok: false };
      })()
    `) as { ok?: boolean };

    if (!result?.ok) return;
    await page.wait({ time: 0.5 });
  }
}

async function resolveUploadSelectors(page: IPage): Promise<string[]> {
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
      const roots = dialogs.length ? dialogs : [document.body];
      const selectors = [];
      let index = 0;

      for (const root of roots) {
        const inputs = Array.from(root.querySelectorAll('input[type="file"]'));
        for (const input of inputs) {
          if (!(input instanceof HTMLInputElement)) continue;
          if (input.disabled) continue;
          const accept = (input.getAttribute('accept') || '').toLowerCase();
          if (accept && !accept.includes('video') && !accept.includes('.mp4')) continue;
          input.setAttribute('data-opencli-reel-upload-index', String(index));
          selectors.push('[data-opencli-reel-upload-index="' + index + '"]');
          index += 1;
        }
      }

      return { ok: selectors.length > 0, selectors };
    })()
  `) as { ok?: boolean; selectors?: string[] };

  if (!result?.ok || !Array.isArray(result.selectors) || result.selectors.length === 0) {
    throw new CommandExecutionError(
      'Instagram reel upload input not found',
      'Open the new-post composer in a logged-in browser session and retry',
    );
  }
  return result.selectors;
}

async function uploadVideo(page: IPage, videoPath: string, selector: string): Promise<void> {
  if (!page.setFileInput) {
    throw new CommandExecutionError(
      'Instagram reel upload requires Browser Bridge file upload support',
      'Use Browser Bridge or another browser mode that supports setFileInput',
    );
  }
  await page.setFileInput([videoPath], selector);
}

async function readSelectedFileCount(page: IPage, selector: string): Promise<number | null> {
  const result = await page.evaluate(`
    (() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      if (!(input instanceof HTMLInputElement)) return { count: null };
      return { count: input.files?.length || 0 };
    })()
  `) as { count?: number | null };
  if (result?.count === null || result?.count === undefined) return null;
  return Number(result.count);
}

async function waitForVideoPreview(page: IPage, maxWaitSeconds = 20): Promise<void> {
  let lastDetail = '';
  for (let attempt = 0; attempt < maxWaitSeconds * 2; attempt += 1) {
    const result = await page.evaluate(buildInspectUploadStageJs()) as { state?: string; detail?: string };
    lastDetail = String(result?.detail || '').trim();
    if (result?.state === 'preview') return;
    if (result?.state === 'failed') {
      throw new CommandExecutionError(
        'Instagram reel upload failed',
        result.detail ? `Instagram rejected the reel upload: ${result.detail}` : 'Instagram rejected the reel upload before the preview stage',
      );
    }
    if (attempt < maxWaitSeconds * 2 - 1) await page.wait({ time: 0.5 });
  }
  await page.screenshot({ path: '/tmp/instagram_reel_preview_debug.png' });
  throw new CommandExecutionError(
    'Instagram reel preview did not appear after upload',
    lastDetail
      ? `Inspect /tmp/instagram_reel_preview_debug.png. Last visible dialog text: ${lastDetail}`
      : 'Inspect /tmp/instagram_reel_preview_debug.png for the upload state',
  );
}

async function clickAction(page: IPage, labels: string[], scope: 'any' | 'media' | 'caption' = 'any'): Promise<string> {
  const result = await page.evaluate(buildClickActionJs(labels, scope)) as { ok?: boolean; label?: string };
  if (!result?.ok) {
    throw new CommandExecutionError(`Instagram action button not found: ${labels.join(' / ')}`);
  }
  return result.label || labels[0] || '';
}

async function clickActionMaybe(page: IPage, labels: string[], scope: 'any' | 'media' | 'caption' = 'any'): Promise<boolean> {
  const result = await page.evaluate(buildClickActionJs(labels, scope)) as { ok?: boolean };
  return !!result?.ok;
}

function buildInspectReelStageJs(): string {
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
      const text = dialogs.map((el) => (el.textContent || '').replace(/\\s+/g, ' ').trim()).join(' ');
      const lower = text.toLowerCase();
      const hasVisibleButton = (labels) => dialogs.some((dialog) =>
        Array.from(dialog.querySelectorAll('button, div[role="button"]')).some((el) => {
          const value = (el.textContent || '').replace(/\\s+/g, ' ').trim().toLowerCase();
          return isVisible(el) && labels.includes(value);
        })
      );
      if (/something went wrong|please try again|share failed|couldn['’]t be shared|could not be shared|失败|出错/.test(lower)) {
        return { state: 'failed', detail: text };
      }
      if (/new reel|write a caption|add location|tag people/.test(lower) && hasVisibleButton(['share'])) {
        return { state: 'composer', detail: text };
      }
      if (/edit|cover photo|trim|video has no audio/.test(lower) && hasVisibleButton(['next'])) {
        return { state: 'edit', detail: text };
      }
      if (/crop|select crop|open media gallery/.test(lower) && hasVisibleButton(['next'])) {
        return { state: 'crop', detail: text };
      }
      return { state: 'pending', detail: text };
    })()
  `;
}

async function waitForReelStage(page: IPage, expected: ReelStageState['state'], maxWaitSeconds = 20): Promise<void> {
  for (let attempt = 0; attempt < maxWaitSeconds * 2; attempt += 1) {
    const result = await page.evaluate(buildInspectReelStageJs()) as ReelStageState;
    if (result?.state === expected) return;
    if (result?.state === 'failed') {
      throw new CommandExecutionError(
        'Instagram reel editor did not appear',
        result.detail ? `Instagram reel flow failed: ${result.detail}` : 'Instagram reel flow failed before the next editor stage',
      );
    }
    if (attempt < maxWaitSeconds * 2 - 1) await page.wait({ time: 0.5 });
  }
  throw new CommandExecutionError(`Instagram reel ${expected} editor did not appear`);
}

async function focusCaptionEditor(page: IPage): Promise<boolean> {
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
        const textarea = dialog.querySelector('[aria-label="Write a caption..."], textarea');
        if (textarea instanceof HTMLTextAreaElement && isVisible(textarea)) {
          textarea.focus();
          textarea.select();
          return { ok: true, kind: 'textarea' };
        }

        const editor = dialog.querySelector('[aria-label="Write a caption..."][contenteditable="true"]')
          || dialog.querySelector('[contenteditable="true"]');
        if (editor instanceof HTMLElement && isVisible(editor)) {
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
        }
      }
      return { ok: false };
    })()
  `) as { ok?: boolean };
  return !!result?.ok;
}

async function captionMatches(page: IPage, content: string): Promise<boolean> {
  const result = await page.evaluate(`
    (() => {
      const target = ${JSON.stringify(content.trim())}.replace(/\\u00a0/g, ' ').replace(/\\s+/g, ' ').trim();
      const isVisible = (el) => {
        if (!(el instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== 'none'
          && style.visibility !== 'hidden'
          && rect.width > 0
          && rect.height > 0;
      };
      const readLexicalText = (node) => {
        if (!node || typeof node !== 'object') return '';
        if (node.type === 'text' && typeof node.text === 'string') return node.text;
        if (!Array.isArray(node.children)) return '';
        if (node.type === 'root') return node.children.map((child) => readLexicalText(child)).join('\\n');
        if (node.type === 'paragraph') return node.children.map((child) => readLexicalText(child)).join('');
        return node.children.map((child) => readLexicalText(child)).join('');
      };
      const dialogs = Array.from(document.querySelectorAll('[role="dialog"]')).filter((el) => isVisible(el));
      for (const dialog of dialogs) {
        const textarea = dialog.querySelector('[aria-label="Write a caption..."], textarea');
        if (textarea instanceof HTMLTextAreaElement && isVisible(textarea)) {
          if (textarea.value.replace(/\\u00a0/g, ' ').replace(/\\s+/g, ' ').trim() === target) {
            return { ok: true };
          }
          continue;
        }

        const editor = dialog.querySelector('[aria-label="Write a caption..."][contenteditable="true"]')
          || dialog.querySelector('[contenteditable="true"]');
        if (!(editor instanceof HTMLElement) || !isVisible(editor)) continue;

        const lexical = editor.__lexicalEditor;
        if (lexical && typeof lexical.getEditorState === 'function') {
          const currentState = lexical.getEditorState();
          const pendingState = lexical._pendingEditorState;
          const current = currentState && typeof currentState.toJSON === 'function' ? currentState.toJSON() : null;
          const pending = pendingState && typeof pendingState.toJSON === 'function' ? pendingState.toJSON() : null;
          const currentText = readLexicalText(current && current.root).replace(/\\u00a0/g, ' ').replace(/\\s+/g, ' ').trim();
          const pendingText = readLexicalText(pending && pending.root).replace(/\\u00a0/g, ' ').replace(/\\s+/g, ' ').trim();
          if (currentText === target || pendingText === target) {
            return { ok: true };
          }
        }

        const value = (editor.textContent || '').replace(/\\u00a0/g, ' ').replace(/\\s+/g, ' ').trim();
        if (value === target) {
          return { ok: true };
        }
      }
      return { ok: false };
    })()
  `) as { ok?: boolean };
  return !!result?.ok;
}

async function fillCaption(page: IPage, content: string): Promise<void> {
  const focused = await focusCaptionEditor(page);
  if (!focused) {
    throw new CommandExecutionError('Instagram reel caption editor did not appear');
  }
  if (page.insertText) {
    try {
      await page.insertText(content);
      await page.wait({ time: 0.3 });
      await page.evaluate(`
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
            const textarea = dialog.querySelector('[aria-label="Write a caption..."], textarea');
            if (textarea instanceof HTMLTextAreaElement && isVisible(textarea)) {
              textarea.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText' }));
              textarea.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
              textarea.blur();
              return { ok: true };
            }

            const editor = dialog.querySelector('[aria-label="Write a caption..."][contenteditable="true"]')
              || dialog.querySelector('[contenteditable="true"]');
            if (!(editor instanceof HTMLElement) || !isVisible(editor)) continue;
            try {
              editor.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText' }));
            } catch {
              editor.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
            }
            editor.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
            editor.blur();
            return { ok: true };
          }
          return { ok: false };
        })()
      `);
      return;
    } catch {
      // Fall back to browser-side editor manipulation below.
    }
  }
  await page.evaluate(`
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
        const textarea = dialog.querySelector('[aria-label="Write a caption..."], textarea');
        if (textarea instanceof HTMLTextAreaElement && isVisible(textarea)) {
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
          textarea.blur();
          return { ok: true, mode: 'textarea' };
        }

        const editor = dialog.querySelector('[aria-label="Write a caption..."][contenteditable="true"]')
          || dialog.querySelector('[contenteditable="true"]');
        if (!(editor instanceof HTMLElement) || !isVisible(editor)) continue;

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
          editor.blur();
          return { ok: true, mode: 'lexical' };
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
        editor.blur();
        return { ok: true, mode: 'contenteditable' };
      }
      return { ok: false };
    })(${JSON.stringify(content)})
  `);
}

async function ensureCaptionFilled(page: IPage, content: string): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (await captionMatches(page, content)) return;
    if (attempt < 5) await page.wait({ time: 0.5 });
  }
  throw new CommandExecutionError('Instagram reel caption did not stick before sharing');
}

function buildReelPublishStatusProbeJs(): string {
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
      const dialogText = dialogs.map((el) => (el.textContent || '').replace(/\\s+/g, ' ').trim()).join(' ');
      const lower = dialogText.toLowerCase();
      const url = window.location.href;
      const sharingVisible = /sharing/.test(lower);
      const shared = /your reel has been shared|reel shared|已分享|已发布/.test(lower) || /\\/reel\\//.test(url);
      const failed = !shared && !sharingVisible && (
        /couldn['’]t be shared|could not be shared|share failed|无法分享|分享失败/.test(lower)
        || (/something went wrong/.test(lower) && /try again/.test(lower))
      );
      const composerOpen = dialogs.some((dialog) =>
        !!dialog.querySelector('textarea, [contenteditable="true"], input[type="file"]')
        || /new reel|cover photo|trim|select from computer|crop|sharing/.test((dialog.textContent || '').toLowerCase())
      );
      const settled = !shared && !composerOpen && !sharingVisible;
      return { ok: shared, failed, settled, url: /\\/reel\\//.test(url) ? url : '' };
    })()
  `;
}

async function waitForPublishSuccess(page: IPage): Promise<string> {
  let settledStreak = 0;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const result = await page.evaluate(buildReelPublishStatusProbeJs()) as { ok?: boolean; failed?: boolean; settled?: boolean; url?: string };
    if (result?.failed) {
      throw new CommandExecutionError('Instagram reel share failed');
    }
    if (result?.ok) {
      return result.url || '';
    }
    if (result?.settled) {
      settledStreak += 1;
      if (settledStreak >= 3) return '';
    } else {
      settledStreak = 0;
    }
    if (attempt < 119) await page.wait({ time: 1 });
  }
  throw new CommandExecutionError('Instagram reel share confirmation did not appear');
}

async function resolveCurrentUserId(page: IPage): Promise<string> {
  const cookies = await page.getCookies({ domain: 'instagram.com' });
  return cookies.find((cookie: BrowserCookie) => cookie.name === 'ds_user_id')?.value || '';
}

async function resolveProfileUrl(page: IPage, currentUserId = ''): Promise<string> {
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
    `) as { ok?: boolean; username?: string };

    if (apiResult?.ok && apiResult.username) {
      return new URL(`/${apiResult.username}/`, INSTAGRAM_HOME_URL).toString();
    }
  }
  return '';
}

async function collectVisibleProfileMediaPaths(page: IPage): Promise<string[]> {
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
      const hrefs = Array.from(document.querySelectorAll('a[href*="/reel/"], a[href*="/p/"]'))
        .filter((el) => el instanceof HTMLAnchorElement && isVisible(el))
        .map((el) => el.getAttribute('href') || '')
        .filter((href) => /^\\/(?:[^/?#]+\\/)?(?:reel|p)\\/[^/?#]+\\/?$/.test(href))
        .filter((href, index, arr) => arr.indexOf(href) === index);
      return { hrefs };
    })()
  `) as { hrefs?: string[] };
  return Array.isArray(result?.hrefs) ? result.hrefs.filter(Boolean) : [];
}

async function captureExistingProfileMediaPaths(page: IPage): Promise<Set<string>> {
  const currentUserId = await resolveCurrentUserId(page);
  if (!currentUserId) return new Set();
  const profileUrl = await resolveProfileUrl(page, currentUserId);
  if (!profileUrl) return new Set();
  try {
    await page.goto(profileUrl);
    await page.wait({ time: 3 });
    return new Set(await collectVisibleProfileMediaPaths(page));
  } catch {
    return new Set();
  }
}

async function resolveLatestReelUrl(page: IPage, existingPaths: ReadonlySet<string>): Promise<string> {
  const currentUrl = await page.getCurrentUrl?.();
  if (currentUrl && /\/reel\//.test(currentUrl)) return currentUrl;

  const currentUserId = await resolveCurrentUserId(page);
  const profileUrl = await resolveProfileUrl(page, currentUserId);
  if (!profileUrl) return '';

  await page.goto(profileUrl);
  await page.wait({ time: 4 });

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const hrefs = await collectVisibleProfileMediaPaths(page);
    const href = hrefs.find((candidate) => candidate.includes('/reel/') && !existingPaths.has(candidate))
      || hrefs.find((candidate) => !existingPaths.has(candidate))
      || '';
    if (href) {
      return new URL(href, INSTAGRAM_HOME_URL).toString();
    }
    if (attempt < 7) await page.wait({ time: 1 });
  }
  return '';
}

cli({
  site: 'instagram',
  name: 'reel',
  description: 'Post an Instagram reel video',
  domain: 'www.instagram.com',
  strategy: Strategy.UI,
  browser: true,
  timeoutSeconds: INSTAGRAM_REEL_TIMEOUT_SECONDS,
  args: [
    { name: 'video', required: false, valueRequired: true, help: 'Path to a single .mp4 video file' },
    { name: 'content', positional: true, required: false, help: 'Caption text' },
  ],
  columns: ['status', 'detail', 'url'],
  validateArgs: validateInstagramReelArgs,
  func: async (page: IPage | null, kwargs) => {
    const browserPage = requirePage(page);
    const videoPath = validateVideoPath(kwargs.video);
    const content = String(kwargs.content ?? '').trim();
    const preparedUpload = prepareVideoUpload(videoPath);

    const run = async (
      activePage: IPage,
      existingMediaPaths: ReadonlySet<string> = new Set(),
    ): Promise<InstagramReelSuccessRow[]> => {
      if (typeof activePage.startNetworkCapture === 'function') {
        await activePage.startNetworkCapture('/rupload_igvideo/|/api/v1/|/reel/|/clips/|/media/|/configure|/upload');
      }
      await gotoInstagramHome(activePage, true);
      await activePage.wait({ time: 2 });
      await dismissResidualDialogs(activePage);
      await ensureComposerOpen(activePage);
      await activePage.wait({ time: 2 });
      const selectors = await resolveUploadSelectors(activePage);
      let uploaded = false;
      let uploadError: unknown;
      for (const selector of selectors) {
        try {
          await uploadVideo(activePage, preparedUpload.uploadPath, selector);
          const selectedFileCount = await readSelectedFileCount(activePage, selector);
          if (selectedFileCount === 0) {
            throw new CommandExecutionError('Instagram reel upload failed', 'The selected reel input never received the video file');
          }
          await waitForVideoPreview(activePage, 10);
          uploaded = true;
          break;
        } catch (error) {
          uploadError = error;
        }
      }
      if (!uploaded) {
        throw uploadError instanceof Error
          ? uploadError
          : new CommandExecutionError('Instagram reel preview did not appear after upload');
      }
      await clickActionMaybe(activePage, ['OK'], 'any');
      await clickAction(activePage, ['Next', '下一步'], 'media');
      await waitForReelStage(activePage, 'edit', 20);
      await clickAction(activePage, ['Next', '下一步'], 'media');
      await waitForReelStage(activePage, 'composer', 20);

      if (content) {
        await fillCaption(activePage, content);
        await ensureCaptionFilled(activePage, content);
      }

      await clickAction(activePage, ['Share', '分享'], 'caption');
      const sharedUrl = await waitForPublishSuccess(activePage);
      const url = sharedUrl || await resolveLatestReelUrl(activePage, existingMediaPaths);
      return buildInstagramReelSuccessResult(url);
    };

    try {
      if (!process.env.VITEST) {
        const runIsolated = async (): Promise<InstagramReelSuccessRow[]> => {
          const isolatedPage = new BrowserPage(`site:instagram-reel-${Date.now()}`);
          try {
            return await run(isolatedPage, new Set());
          } finally {
            await isolatedPage.closeWindow?.();
          }
        };

        try {
          return await runIsolated();
        } catch (error) {
          if (!isRecoverableReelSessionError(error)) throw error;
          return await runIsolated();
        }
      }

      const existingMediaPaths = await captureExistingProfileMediaPaths(browserPage);
      return await run(browserPage, existingMediaPaths);
    } finally {
      if (preparedUpload.cleanupPath) {
        fs.rmSync(preparedUpload.cleanupPath, { force: true });
      }
    }
  },
});
