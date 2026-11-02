/**
 * Xiaohongshu 视频笔记 publisher — creator center UI automation.
 *
 * Topics are only accepted when the resulting topic chip text equals the
 * requested name; wrong auto-suggestions are removed and retried with
 * ArrowDown, then skipped and reported. `--declaration ai` selects
 * 「笔记含AI合成内容」and `--schedule` sets 定时发布 before submitting.
 *
 * Usage:
 *   opencli xiaohongshu publish-video --title "标题(20字内)" "正文内容" \
 *     --video /path/to/video.mp4 \
 *     [--cover /path/to/cover-3x4.png] \
 *     [--topics 中式梦核,梦核,怀旧] \
 *     [--declaration ai] \
 *     [--schedule "2026-11-02 21:30"] \
 *     [--draft]
 */
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import { CommandExecutionError, ArgumentError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';

const PUBLISH_VIDEO_URL = 'https://creator.xiaohongshu.com/publish/publish?from=menu_left&target=video';
const MAX_TITLE_LEN = 20;

const TITLE_SELECTORS = [
  '[contenteditable="true"][placeholder*="标题"]',
  '[contenteditable="true"][placeholder*="赞"]',
  'input[placeholder*="标题"]',
  'input[placeholder*="填写标题"]',
  'input[placeholder*="title" i]',
  '[contenteditable="true"][class*="title"]',
  'input[maxlength="20"]',
  'input[class*="title"]',
  '.title-input input',
  '.note-title input',
];

const BODY_SELECTORS = [
  '[contenteditable="true"][class*="content"]',
  '[contenteditable="true"][class*="editor"]',
  '[contenteditable="true"][placeholder*="描述"]',
  '[contenteditable="true"][placeholder*="正文"]',
  '[contenteditable="true"][placeholder*="内容"]',
  '.note-content [contenteditable="true"]',
  '.editor-content [contenteditable="true"]',
  '.tiptap.ProseMirror',
  '[contenteditable="true"]:not([placeholder*="标题"]):not([placeholder*="赞"]):not([placeholder*="title" i])',
];

const PUBLISH_METHOD_NAMES = ['_onPublish', 'onPublish', '_onSubmit', '_handlePublish'];
const DRAFT_METHOD_NAMES = ['_onSave', '_onSaveDraft', '_onDraft'];

function unwrapBrowserResult(value) {
  if (
    value &&
    typeof value === 'object' &&
    typeof value.session === 'string' &&
    Object.prototype.hasOwnProperty.call(value, 'data')
  ) {
    return value.data;
  }
  return value;
}

async function fillField(page, selectors, text, fieldName) {
  const located = unwrapBrowserResult(
    await page.evaluate(`
      (function(selectors) {
        for (const sel of selectors) {
          const candidates = document.querySelectorAll(sel);
          for (const el of candidates) {
            if (!el || el.offsetParent === null || el.offsetWidth <= 50) continue;
            const kind = el.isContentEditable
              ? 'contenteditable'
              : (el.tagName === 'TEXTAREA' ? 'textarea' : 'input');
            return { ok: true, sel, kind };
          }
        }
        return { ok: false };
      })(${JSON.stringify(selectors)})
    `)
  );
  if (!located?.ok) {
    throw new CommandExecutionError(`Could not find ${fieldName} input on video publish page.`);
  }
  if (located.kind === 'contenteditable' && typeof page.insertText === 'function') {
    await page.evaluate(`
      ((selector) => {
        const el = Array.from(document.querySelectorAll(selector)).find(n => n && n.offsetParent !== null && n.offsetWidth > 50);
        if (!el) return false;
        el.focus();
        el.textContent = '';
        return true;
      })(${JSON.stringify(located.sel)})
    `);
    await page.insertText(text);
    return;
  }
  await page.evaluate(`
    ((selector, expectedText) => {
      const el = Array.from(document.querySelectorAll(selector)).find(n => n && n.offsetParent !== null && n.offsetWidth > 50);
      if (!el) return false;
      el.focus();
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (nativeSetter) nativeSetter.call(el, expectedText);
        else el.value = expectedText;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.blur();
        return true;
      }
      el.textContent = expectedText;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.blur();
      return true;
    })(${JSON.stringify(located.sel)}, ${JSON.stringify(text)})
  `);
}

async function injectFileViaDataTransfer(page, filePath, mimeType, inputSelector) {
  const fileName = path.basename(filePath);
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    const stat = fs.statSync(filePath);
    res.writeHead(200, {
      'Content-Type': mimeType,
      'Content-Length': stat.size,
    });
    fs.createReadStream(filePath).pipe(res);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const localUrl = `http://127.0.0.1:${port}/${encodeURIComponent(fileName)}`;

  try {
    const res = unwrapBrowserResult(
      await page.evaluate(`
        (async (sel, url, name, mime) => {
          try {
            const input = document.querySelector(sel) || document.querySelector('input[type="file"]');
            if (!input) return { ok: false, error: 'No file input found for selector: ' + sel };
            const resp = await fetch(url);
            if (!resp.ok) return { ok: false, error: 'Fetch failed: ' + resp.status };
            const blob = await resp.blob();
            const file = new File([blob], name, { type: mime, lastModified: Date.now() });
            const dt = new DataTransfer();
            dt.items.add(file);
            Object.defineProperty(input, 'files', { value: dt.files, writable: false, configurable: true });
            input.dispatchEvent(new Event('change', { bubbles: true }));
            input.dispatchEvent(new Event('input', { bubbles: true }));
            return { ok: true, size: file.size, name: file.name };
          } catch (e) {
            return { ok: false, error: String(e && e.message ? e.message : e) };
          }
        })(${JSON.stringify(inputSelector)}, ${JSON.stringify(localUrl)}, ${JSON.stringify(fileName)}, ${JSON.stringify(mimeType)})
      `)
    );
    return res;
  } finally {
    server.close();
  }
}

async function clickLabel(page, labels) {
  return unwrapBrowserResult(
    await page.evaluate(`
      (labels => {
        const nodes = Array.from(document.querySelectorAll('button, [role="button"], div, span, a, li, label'));
        for (const label of labels) {
          const el = nodes.find(node => {
            if (!node || (node.innerText || '').trim() !== label) return false;
            const rect = node.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });
          if (!el) continue;
          el.scrollIntoView({ block: 'center' });
          el.click();
          return true;
        }
        return false;
      })(${JSON.stringify(labels)})
    `)
  );
}

async function uploadCustomCover(page, coverPath) {
  const opened = await clickLabel(page, ['编辑封面', '设置封面', '修改封面', '更换封面']);
  if (!opened) return 'open';
  await page.wait({ time: 1.5 });

  await clickLabel(page, ['上传封面', '本地上传', '上传图片']);
  await page.wait({ time: 2.0 });

  const imgSel = unwrapBrowserResult(
    await page.evaluate(`
      (() => {
        const explicit = document.querySelector('input[aria-label="上传封面图片"]');
        if (explicit) {
          explicit.setAttribute('data-opencli-cover', '1');
          return 'input[data-opencli-cover="1"]';
        }
        const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
        const target =
          inputs.find(el => {
            const accept = String(el.getAttribute('accept') || '').toLowerCase();
            const aria = String(el.getAttribute('aria-label') || '');
            return /image|\.png|\.jpg/.test(accept) || /封面/.test(aria);
          }) || inputs[inputs.length - 1];
        if (!target) return null;
        target.setAttribute('data-opencli-cover', '1');
        return 'input[data-opencli-cover="1"]';
      })()
    `)
  );
  if (!imgSel) return 'input';

  let uploaded = false;
  if (page.setFileInput) {
    try {
      await page.setFileInput([coverPath], imgSel);
      uploaded = true;
    } catch {}
  }
  if (!uploaded) {
    const ext = path.extname(coverPath).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
    const injected = await injectFileViaDataTransfer(page, coverPath, mime, imgSel);
    uploaded = Boolean(injected && injected.ok);
  }
  if (!uploaded) return 'upload';

  await page.wait({ time: 4 });
  let confirmed = false;
  for (let attempt = 0; attempt < 3 && !confirmed; attempt += 1) {
    confirmed = await clickLabel(page, ['完成', '确定', '确认']);
    if (!confirmed) await page.wait({ time: 1.5 });
  }
  if (!confirmed) return 'confirm';
  await page.wait({ time: 1.5 });
  return 'ok';
}

function normalizeTopicName(raw) {
  return String(raw || '')
    .replace(/^#/, '')
    .replace(/\[话题\]#?/g, '')
    .replace(/\s+/g, '')
    .trim();
}

async function readTopicNames(page, bodySelectors) {
  const names = unwrapBrowserResult(
    await page.evaluate(`
      (selectors => {
        const editor = selectors
          .map(sel => Array.from(document.querySelectorAll(sel)))
          .flat()
          .find(node => node && node.offsetParent !== null && node.isContentEditable);
        if (!editor) return [];
        const chips = Array.from(editor.querySelectorAll('.tiptap-topic, a[data-topic]'))
          .map(el => el.textContent || '');
        const text = editor.innerText || editor.textContent || '';
        const markers = [];
        for (const part of text.split('#')) {
          const end = part.indexOf('[话题]#');
          if (end > 0) markers.push(part.slice(0, end).trim());
        }
        return chips.concat(markers);
      })(${JSON.stringify(bodySelectors)})
    `)
  );
  return Array.isArray(names) ? names.map(normalizeTopicName).filter(Boolean) : [];
}

async function deleteLastTopic(page, bodySelectors) {
  return unwrapBrowserResult(
    await page.evaluate(`
      (selectors => {
        const editor = selectors
          .map(sel => Array.from(document.querySelectorAll(sel)))
          .flat()
          .find(node => node && node.offsetParent !== null && node.isContentEditable);
        if (!editor) return false;
        const nodes = editor.querySelectorAll('.tiptap-topic, a[data-topic]');
        const el = nodes[nodes.length - 1];
        if (!el) return false;
        editor.focus();
        const range = document.createRange();
        range.selectNode(el);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        return document.execCommand('delete');
      })(${JSON.stringify(bodySelectors)})
    `)
  );
}

async function typeTopicQuery(page, bodySelectors, topic) {
  await page.evaluate(`
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
      selection.removeAllRanges();
      selection.addRange(range);
      return true;
    })(${JSON.stringify(bodySelectors)})
  `);
  if (typeof page.pressKey === 'function') {
    try {
      await page.pressKey('Enter');
    } catch {}
  }
  await page.insertText(`#${topic}`);
  await page.wait({ time: 1.2 });
}

/**
 * Add topics, accepting only a suggestion whose text equals the requested name.
 *
 * The suggestion dropdown lives in a closed shadow root, so its items cannot be
 * queried. XHS highlights the first match automatically; Enter accepts it. We
 * therefore accept, read the resulting topic chip, and if the chip is not the
 * requested topic, delete it and retry with one more ArrowDown step. Topics
 * that never match are skipped and reported instead of being silently added
 * under a different name.
 */
async function addTopics(page, bodySelectors, topics) {
  const added = [];
  const skipped = [];
  for (const topic of topics) {
    const want = normalizeTopicName(topic);
    const before = await readTopicNames(page, bodySelectors);
    const beforeMatches = before.filter(name => name === want).length;
    let matched = false;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await typeTopicQuery(page, bodySelectors, topic);
      for (let down = 0; down < attempt; down += 1) {
        if (typeof page.pressKey === 'function') {
          await page.pressKey('ArrowDown');
          await page.wait({ time: 0.15 });
        }
      }
      if (typeof page.pressKey === 'function') {
        await page.pressKey('Enter');
      }
      await page.wait({ time: 0.7 });
      const after = await readTopicNames(page, bodySelectors);
      if (after.filter(name => name === want).length > beforeMatches) {
        matched = true;
        break;
      }
      if (after.length > before.length) {
        const deleted = await deleteLastTopic(page, bodySelectors);
        if (!deleted) {
          throw new CommandExecutionError(
            `Topic "${topic}" was auto-selected as a different name and could not be removed. Refusing to publish.`
          );
        }
        const check = await readTopicNames(page, bodySelectors);
        if (check.length >= after.length) {
          throw new CommandExecutionError(
            `Topic "${topic}" could not be cleaned up before retry. Refusing to publish.`
          );
        }
      } else {
        // No chip appeared. Remove the typed query and stop retrying this topic.
        if (typeof page.pressKey === 'function') {
          for (let i = 0; i < topic.length + 2; i += 1) {
            await page.pressKey('Backspace');
          }
        }
        break;
      }
    }
    if (matched) added.push(topic);
    else skipped.push(topic);
  }
  return { added, skipped };
}

async function selectDeclaration(page, declaration) {
  const value = String(declaration || '').trim().toLowerCase();
  const label = value === 'ai' ? '笔记含AI合成内容' : '';
  if (!label) throw new ArgumentError('Unsupported --declaration value: ' + declaration);

  const hostPoint = unwrapBrowserResult(
    await page.evaluate(`
      (() => {
        const selects = Array.from(document.querySelectorAll('.d-select-main'))
          .filter(el => el && el.offsetParent !== null);
        const host = selects.find(el => /内容类型声明|AI合成/.test(el.innerText || ''));
        if (!host) return null;
        host.scrollIntoView({ block: 'center' });
        const rect = host.getBoundingClientRect();
        return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
      })()
    `)
  );
  if (!hostPoint) throw new CommandExecutionError('Content-type declaration control not found');

  let opened = false;
  if (typeof page.nativeClick === 'function') {
    try {
      await page.nativeClick(hostPoint.x, hostPoint.y);
      opened = true;
    } catch {}
  }
  if (!opened) {
    await page.evaluate(`
      (() => {
        const host = Array.from(document.querySelectorAll('.d-select-main'))
          .find(el => el && el.offsetParent !== null && /内容类型声明|AI合成/.test(el.innerText || ''));
        if (host) host.click();
      })()
    `);
  }
  await page.wait({ time: 1.2 });

  const optionPoint = unwrapBrowserResult(
    await page.evaluate(`
      (label => {
        const nodes = Array.from(document.querySelectorAll('*')).filter(
          node => node && node.offsetParent !== null && (node.textContent || '').trim() === label
        );
        const el = nodes[nodes.length - 1];
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return null;
        return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
      })(${JSON.stringify(label)})
    `)
  );
  if (!optionPoint) {
    const hiddenClick = unwrapBrowserResult(
      await page.evaluate(`
        (label => {
          const nodes = Array.from(document.querySelectorAll('*')).filter(
            node => node && (node.textContent || '').trim() === label
          );
          const el = nodes[nodes.length - 1];
          if (!el) return false;
          el.click();
          return true;
        })(${JSON.stringify(label)})
      `)
    );
    if (!hiddenClick) throw new CommandExecutionError('Declaration option not found: ' + label);
    await page.wait({ time: 0.6 });
  } else if (typeof page.nativeClick === 'function') {
    try {
      await page.nativeClick(optionPoint.x, optionPoint.y);
    } catch {
      await page.evaluate(`
        (label => {
          const nodes = Array.from(document.querySelectorAll('*')).filter(
            node => node && (node.textContent || '').trim() === label
          );
          const el = nodes[nodes.length - 1];
          if (el) el.click();
        })(${JSON.stringify(label)})
      `);
    }
  } else {
    await page.evaluate(`
      (label => {
        const nodes = Array.from(document.querySelectorAll('*')).filter(
          node => node && node.offsetParent !== null && (node.textContent || '').trim() === label
        );
        const el = nodes[nodes.length - 1];
        if (el) el.click();
      })(${JSON.stringify(label)})
    `);
  }
  await page.wait({ time: 0.6 });

  const applied = unwrapBrowserResult(
    await page.evaluate(`
      (() => {
        const selects = Array.from(document.querySelectorAll('.d-select-main'))
          .filter(el => el && el.offsetParent !== null);
        const host = selects.find(el => /内容类型声明|AI合成/.test(el.innerText || ''));
        return host ? (host.innerText || '').trim() : '';
      })()
    `)
  );
  if (!applied || !applied.includes(label)) {
    throw new CommandExecutionError('Declaration was not applied: ' + label);
  }
}

async function setSchedule(page, value) {
  const when = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(when)) {
    throw new ArgumentError('--schedule must be "YYYY-MM-DD HH:mm"');
  }

  const switchPoint = unwrapBrowserResult(
    await page.evaluate(`
      (() => {
        const box = document.querySelector('.post-time-switch-container input[type=checkbox]');
        if (!box) return null;
        if (box.checked) return { already: true };
        const host = box.closest('.d-switch') || box.parentElement;
        host.scrollIntoView({ block: 'center' });
        const rect = host.getBoundingClientRect();
        return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
      })()
    `)
  );
  if (!switchPoint) throw new CommandExecutionError('Schedule switch not found');
  if (!switchPoint.already) {
    let toggled = false;
    if (typeof page.nativeClick === 'function') {
      try {
        await page.nativeClick(switchPoint.x, switchPoint.y);
        toggled = true;
      } catch {}
    }
    if (!toggled) {
      await page.evaluate(
        `document.querySelector('.post-time-switch-container input[type=checkbox]')?.click()`
      );
    }
    await page.wait({ time: 1.2 });
  }

  let inputValue = '';
  for (let attempt = 0; attempt < 4; attempt += 1) {
    inputValue = unwrapBrowserResult(
      await page.evaluate(`
        (when => {
          const inputs = Array.from(document.querySelectorAll('input'))
            .filter(el => el && el.offsetParent !== null && el.type === 'text');
          const input =
            document.querySelector('.d-datepicker-main input.d-text') ||
            inputs.find(el => /^\\d{4}-\\d{2}-\\d{2}/.test(el.value || '')) ||
            inputs.find(el => /date|time|picker/i.test(String(el.className)));
          if (!input) return '';
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
          if (setter) setter.call(input, when);
          else input.value = when;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          input.blur();
          return input.value;
        })(${JSON.stringify(when)})
      `)
    );
    if (inputValue) break;
    await page.wait({ time: 1 });
  }
  if (!inputValue) throw new CommandExecutionError('Could not set schedule: schedule input not found');
  await page.wait({ time: 0.8 });

  const confirmed = unwrapBrowserResult(
    await page.evaluate(`
      (when => {
        const box = document.querySelector('.post-time-switch-container input[type=checkbox]');
        const input = document.querySelector('.d-datepicker-main input.d-text');
        return {
          checked: Boolean(box && box.checked),
          value: input ? input.value : '',
        };
      })(${JSON.stringify(when)})
    `)
  );
  if (!confirmed?.checked || !String(confirmed.value || '').startsWith(when)) {
    throw new CommandExecutionError(
      `Schedule was not confirmed (checked=${confirmed?.checked}, value=${confirmed?.value || ''}). Refusing to publish.`
    );
  }
  return confirmed.value;
}

cli({
  site: 'xiaohongshu',
  name: 'publish-video',
  access: 'write',
  description: '小红书发布视频笔记 (creator center UI automation)',
  domain: 'creator.xiaohongshu.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'content', required: true, positional: true, help: '笔记正文' },
    { name: 'title', required: true, help: '笔记标题 (最多20字)' },
    { name: 'video', required: true, help: '视频绝对路径 (.mp4/.mov)' },
    { name: 'cover', required: false, help: '可选：自定义封面图片路径 (.png/.jpg)' },
    { name: 'topics', required: false, help: '话题标签，逗号分隔，不含 # 号' },
    { name: 'declaration', required: false, help: '内容类型声明：ai = 笔记含AI合成内容' },
    { name: 'schedule', required: false, help: '定时发布，格式 "YYYY-MM-DD HH:mm"（本地时间）' },
    { name: 'draft', type: 'bool', default: false, help: '保存为草稿，不直接发布' },
  ],
  columns: ['status', 'detail'],
  func: async (page, kwargs) => {
    if (!page) throw new Error('Browser page required');
    const title = String(kwargs.title ?? '').trim();
    const content = String(kwargs.content ?? '').trim();
    const videoPath = path.resolve(String(kwargs.video ?? '').trim());
    const coverPath = kwargs.cover ? path.resolve(String(kwargs.cover).trim()) : '';
    const topics = kwargs.topics
      ? String(kwargs.topics).split(',').map((s) => s.trim()).filter(Boolean)
      : [];
    const isDraft = Boolean(kwargs.draft);

    if (!title) throw new ArgumentError('--title is required');
    if (title.length > MAX_TITLE_LEN) {
      throw new ArgumentError(`小红书标题限 ${MAX_TITLE_LEN} 字以内（当前 ${title.length} 字）`);
    }
    if (!fs.existsSync(videoPath)) {
      throw new ArgumentError(`Video file not found: ${videoPath}`);
    }
    if (coverPath && !fs.existsSync(coverPath)) {
      throw new ArgumentError(`Cover file not found: ${coverPath}`);
    }

    await page.goto(PUBLISH_VIDEO_URL);
    await page.wait({ time: 3 });

    const videoInputSel = unwrapBrowserResult(
      await page.evaluate(`
        (() => {
          const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
          for (const inp of inputs) {
            const acc = (inp.getAttribute('accept') || '').toLowerCase();
            if (acc.includes('video') || acc.includes('.mp4') || acc.includes('.mov')) {
              return 'input[type="file"][accept*=".mp4"], input[type="file"][accept*="video"], input[type="file"]';
            }
          }
          return inputs.length ? 'input[type="file"]' : null;
        })()
      `)
    );
    if (!videoInputSel) {
      throw new CommandExecutionError('No video file input found on creator.xiaohongshu.com/publish/publish');
    }

    const injected = await injectFileViaDataTransfer(page, videoPath, 'video/mp4', videoInputSel);
    if (!injected?.ok) {
      throw new CommandExecutionError(`Video upload injection failed: ${injected?.error || 'unknown'}`);
    }
    await page.wait({ time: 4 });

    for (let i = 0; i < 90; i++) {
      const state = unwrapBrowserResult(
        await page.evaluate(`
          (titleSels => {
            const bodyText = document.body.innerText || '';
            const hasForm = titleSels.some(s => {
              const el = document.querySelector(s);
              return el && el.offsetParent !== null;
            });
            const uploading = bodyText.includes('上传中') || bodyText.includes('转码中') || !!document.querySelector('[class*="progress"][class*="upload"]');
            const done = bodyText.includes('上传成功') || bodyText.includes('重新上传') || bodyText.includes('替换视频') || bodyText.includes('设置封面') || bodyText.includes('修改封面');
            return { hasForm, uploading, done };
          })(${JSON.stringify(TITLE_SELECTORS)})
        `)
      );
      if (state?.hasForm && state?.done && !state?.uploading) break;
      await page.wait({ time: 2 });
    }

    let coverWarning = '';
    if (coverPath) {
      let coverStage = 'error';
      try {
        coverStage = await uploadCustomCover(page, coverPath);
      } catch (err) {
        throw new CommandExecutionError(
          'Cover upload failed: ' + (err && err.message ? err.message : String(err))
        );
      }
      if (coverStage !== 'ok') {
        coverWarning = `封面未应用(${coverStage})`;
      }
    }

    await fillField(page, TITLE_SELECTORS, title, 'title');
    await page.wait({ time: 0.5 });
    await fillField(page, BODY_SELECTORS, content, 'content');
    await page.wait({ time: 0.5 });

    let addedTopics = [];
    let skippedTopics = [];
    if (topics.length) {
      const topicResult = await addTopics(page, BODY_SELECTORS, topics);
      addedTopics = topicResult.added;
      skippedTopics = topicResult.skipped;
    }

    let scheduleValue = '';
    if (kwargs.declaration) {
      await selectDeclaration(page, kwargs.declaration);
    }
    if (kwargs.schedule) {
      scheduleValue = await setSchedule(page, kwargs.schedule);
    }

    const actionLabels = isDraft ? ['暂存离开', '存草稿'] : ['发布', '发布笔记'];
    const beforeUrl = unwrapBrowserResult(await page.evaluate('() => location.href'));
    const invokeResult = unwrapBrowserResult(
      await page.evaluate(`
        (async cfg => {
          const { isDraftMode, publishNames, draftNames, labels } = cfg;
          const isVisible = (el) => {
            if (!el || el.offsetParent === null) return false;
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          };
          const hosts = Array.from(document.querySelectorAll('xhs-publish-btn')).filter(isVisible);
          const wanted = isDraftMode ? draftNames : publishNames;
          for (const host of hosts) {
            for (const name of wanted) {
              if (typeof host[name] !== 'function') continue;
              try {
                await host[name]();
                return { ok: true, via: 'method', name };
              } catch (err) {
                return { ok: false, via: 'method', name, error: String(err && err.message || err) };
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
          return { ok: false };
        })(${JSON.stringify({
          isDraftMode: isDraft,
          publishNames: PUBLISH_METHOD_NAMES,
          draftNames: DRAFT_METHOD_NAMES,
          labels: actionLabels,
        })})
      `)
    );

    if (!invokeResult?.ok) {
      throw new CommandExecutionError(`Could not trigger "${actionLabels[0]}" on Xiaohongshu video publish page`);
    }

    await page.wait({ time: 4 });
    const verb = isDraft ? '暂存成功' : '发布成功';
    const finalUrl = unwrapBrowserResult(await page.evaluate('() => location.href'));
    const markers = isDraft
      ? ['草稿已保存', '暂存成功', '保存成功', '保存于']
      : ['发布成功', '定时发布成功'];
    const successMsg = unwrapBrowserResult(
      await page.evaluate(`
        (markers => {
          for (const el of document.querySelectorAll('*')) {
            if (el.tagName === 'STYLE' || el.tagName === 'SCRIPT') continue;
            if (el.closest && el.closest('.tiptap, .ProseMirror, .note-content, .editor-content')) continue;
            const text = (el.innerText || el.textContent || '').trim();
            if (!text || text.length > 60 || el.children.length > 0) continue;
            if (markers.some(marker => text.includes(marker))) return text;
          }
          return '';
        })(${JSON.stringify(markers)})
      `)
    );
    const urlChanged = Boolean(finalUrl) && String(finalUrl) !== String(beforeUrl);
    const urlLooksSuccessful = urlChanged && /published=true|success|draft/i.test(String(finalUrl));
    if (!successMsg && !urlLooksSuccessful) {
      throw new CommandExecutionError(
        `${verb} could not be verified: no success marker or post-submit navigation was observed. Current URL: ${finalUrl}`
      );
    }
    return [
      {
        status: `✅ ${verb}`,
        detail: [
          `"${title}"`,
          path.basename(videoPath),
          coverPath ? (coverWarning || `封面:${path.basename(coverPath)}`) : '',
          addedTopics.length ? `话题: ${addedTopics.join(' ')}` : '',
          successMsg ? `结果:${successMsg}` : '',
          skippedTopics.length ? `跳过: ${skippedTopics.join(' ')}` : '',
          kwargs.declaration ? `声明:${kwargs.declaration}` : '',
          scheduleValue ? `定时:${scheduleValue}` : '',
        ].filter(Boolean).join(' · '),
      },
    ];
  },
});
