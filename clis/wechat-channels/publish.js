/**
 * WeChat Channels (视频号) publish — UI automation for WeChat Video Channels creator center.
 *
 * Flow:
 *   1. Navigate to https://channels.weixin.qq.com/platform/post/create
 *   2. Upload video via CDP setFileInput (with shadow-DOM DataTransfer fallback)
 *   3. Wait for upload + transcode completion
 *   4. Fill title (主要内容) and description
 *   5. Add hashtag tags (appended to description)
 *   6. Set scheduled publish time (optional)
 *   7. Click publish or save draft
 *
 * Note: The creator center renders inside a wujie micro-frontend shadow DOM.
 * All form elements are inside wujie-app::shadow-root. The adapter handles
 * shadow DOM traversal transparently for all interactions.
 *
 * Requires: logged into channels.weixin.qq.com in Chrome.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';

// ── Constants ──────────────────────────────────────────────────────────────
const PUBLISH_URL = 'https://channels.weixin.qq.com/platform/post/create';
const LOGIN_PATH_FRAGMENT = 'login';

// Title: "短标题" field visible in the form (from screenshot)
const TITLE_SELECTORS = [
  'input[placeholder*="短标题"]',
  'input[placeholder*="填写短标题"]',
  'input.weui-desktop-form__input[placeholder*="短标题"]',
  'input.weui-desktop-form__input',
];

// Description: "添加描述" contenteditable area (from screenshot)
const DESC_SELECTORS = [
  'div[contenteditable][data-placeholder="添加描述"]',
  'div.input-editor[contenteditable=""][data-placeholder="添加描述"]',
  'div[data-placeholder*="描述"][contenteditable]',
  'div.input-editor[contenteditable]',
];

// Upload trigger buttons (click to activate the hidden file input)
const UPLOAD_TRIGGER_SELECTORS = [
  'span.add-icon.weui-icon-outlined-add',
  'div.upload-content',
  '.finder-video-upload-btn',
];

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.avi', '.webm']);

function unwrapEvaluateResult(result) {
  if (result && typeof result === 'object' && 'data' in result && 'session' in result) {
    return result.data;
  }
  return result;
}

async function evalPage(page, script) {
  return unwrapEvaluateResult(await page.evaluate(script));
}

function requireFilePath(filePath, label, allowedExts) {
  const resolved = path.resolve(String(filePath));
  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch {
    throw new ArgumentError(`${label}文件不存在: ${resolved}`);
  }
  if (!stat.isFile()) {
    throw new ArgumentError(`${label}路径不是文件: ${resolved}`);
  }
  const ext = path.extname(resolved).toLowerCase();
  if (!allowedExts.has(ext)) {
    throw new ArgumentError(`不支持的${label}格式: ${ext}（支持 ${Array.from(allowedExts).join('/')}）`);
  }
  return resolved;
}

function parseTimeoutSeconds(raw) {
  const timeout = raw == null || raw === '' ? 600 : Number(raw);
  if (!Number.isInteger(timeout) || timeout < 30) {
    throw new ArgumentError('--timeout must be an integer >= 30 seconds');
  }
  return timeout;
}

function parseScheduleDate(raw) {
  if (!raw) return null;
  const dt = typeof raw === 'number'
    ? new Date(raw < 1e12 ? raw * 1000 : raw)
    : new Date(String(raw));
  if (Number.isNaN(dt.getTime())) {
    throw new ArgumentError(`无法解析定时时间: ${raw}`);
  }
  if (dt.getTime() <= Date.now()) {
    throw new ArgumentError('定时时间必须晚于当前时间');
  }
  return dt;
}

function parseBooleanFlag(raw) {
  return raw === true || raw === 'true' || raw === '1' || raw === 1;
}

function remainingMs(deadline, label) {
  const left = deadline - Date.now();
  if (left <= 0) {
    throw new CommandExecutionError(`${label}超时，请增加 --timeout 后重试`);
  }
  return left;
}

function submitSucceeded({ isDraft, finalUrl, successMsg }) {
  const msg = String(successMsg || '');
  if (isDraft) {
    return /草稿已保存|暂存成功|保存成功/.test(msg);
  }
  if (/已发表|发布成功|发表成功|审核中/.test(msg)) {
    return true;
  }
  const url = String(finalUrl || '');
  return /\/platform\/post\/list\b/.test(url);
}

export const __test__ = {
  parseTimeoutSeconds,
  parseScheduleDate,
  parseBooleanFlag,
  requireFilePath,
  submitSucceeded,
};

// ── Shadow DOM utility (inlined into evaluate calls) ───────────────────────
// wujie creates exactly ONE shadow root on <wujie-app>; all creator-center UI
// lives inside it. We go directly there instead of recursing all elements,
// which avoids expensive querySelectorAll('*') traversals on a large page.
const DEEP_QUERY_FN = `
  function wujieRoot() {
    var w = document.querySelector('wujie-app');
    return (w && w.shadowRoot) || null;
  }
  function deepQuery(selector) {
    var el = document.querySelector(selector);
    if (el) return el;
    var sr = wujieRoot();
    return sr ? sr.querySelector(selector) : null;
  }
  function deepQueryAll(selector) {
    var results = [];
    var main = document.querySelectorAll(selector);
    for (var i = 0; i < main.length; i++) results.push(main[i]);
    var sr = wujieRoot();
    if (sr) {
      var shadow = sr.querySelectorAll(selector);
      for (var i = 0; i < shadow.length; i++) results.push(shadow[i]);
    }
    return results;
  }
  function isVisible(el) {
    if (!el) return false;
    var rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }
`;

// ── Helper: click upload trigger ────────────────────────────────────────────
async function clickUploadTrigger(page) {
  const clicked = await evalPage(page, `
    (() => {
      ${DEEP_QUERY_FN}
      var sels = ${JSON.stringify(UPLOAD_TRIGGER_SELECTORS)};
      for (var i = 0; i < sels.length; i++) {
        var el = deepQuery(sels[i]);
        if (el && isVisible(el)) {
          el.click();
          return { ok: true, sel: sels[i] };
        }
      }
      return { ok: false };
    })()
  `);
  return clicked;
}

// ── Helper: upload video file ────────────────────────────────────────────────
async function uploadFile(page, absPath) {
  // Strategy 1: page.setFileInput — works if input is in main document
  if (page.setFileInput) {
    await clickUploadTrigger(page);
    await page.wait({ time: 1 });
    for (const sel of ['input[type="file"][accept*="video"]', 'input[type="file"]']) {
      try {
        await page.setFileInput([absPath], sel);
        return;
      } catch (_) {}
    }
  }

  // Strategy 2: DataTransfer injection via chunked base64.
  // Splits the file into ~50KB chunks so no single evaluate call exceeds the
  // bridge message limit. Works for shadow DOM file inputs where setFileInput fails.

  const fileData = fs.readFileSync(absPath);
  const base64Full = fileData.toString('base64');
  const fileName = path.basename(absPath);
  const ext = path.extname(absPath).toLowerCase();
  const mimeMap = { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.avi': 'video/avi', '.webm': 'video/webm' };
  const mimeType = mimeMap[ext] || 'video/mp4';

  // Initialize accumulator in page context
  await evalPage(page, '() => { window.__oc_chunks = []; }');

  // Send in 50KB chunks to stay well under bridge message limits
  const CHUNK = 50_000;
  for (let i = 0; i < base64Full.length; i += CHUNK) {
    const chunk = base64Full.slice(i, i + CHUNK);
    await evalPage(page, `((c) => { window.__oc_chunks.push(c); })(${JSON.stringify(chunk)})`);
  }

  // Trigger click + assemble + set on shadow DOM input
  await clickUploadTrigger(page);
  await page.wait({ time: 0.5 });

  const result = await evalPage(page, `
    (function(params) {
      ${DEEP_QUERY_FN}
      var inputSels = ['input[type="file"][accept*="video"]', 'input[type="file"]'];
      var input = null;
      for (var i = 0; i < inputSels.length; i++) {
        input = deepQuery(inputSels[i]);
        if (input) break;
      }
      if (!input) { window.__oc_chunks = []; return { ok: false, error: 'No file input found' }; }

      try {
        var b64 = window.__oc_chunks.join('');
        window.__oc_chunks = [];
        var binary = atob(b64);
        var bytes = new Uint8Array(binary.length);
        for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        var dt = new DataTransfer();
        dt.items.add(new File([bytes], params.fileName, { type: params.mimeType }));
        Object.defineProperty(input, 'files', { value: dt.files, configurable: true });
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new Event('input',  { bubbles: true }));
        return { ok: true };
      } catch(e) {
        window.__oc_chunks = [];
        return { ok: false, error: e.message };
      }
    })(${JSON.stringify({ fileName, mimeType })})
  `);

  if (!result?.ok) {
    await page.screenshot({ path: '/tmp/wechat-channels_publish_upload_debug.png' });
    throw new CommandExecutionError(`视频文件注入失败: ${result?.error ?? 'unknown'}\n截图已保存到 /tmp/wechat-channels_publish_upload_debug.png`);
  }
}

// ── Helper: wait for upload + transcode completion ───────────────────────────
async function waitForUploadDone(page, fileName, maxMs = 180_000) {
  const pollMs = 3_000;
  const maxAttempts = Math.ceil(maxMs / pollMs);

  for (let i = 0; i < maxAttempts; i++) {
    let done;
    try {
      done = await evalPage(page, `
        ((fileName) => {
          ${DEEP_QUERY_FN}
          var root = wujieRoot() || document;
          var bodyText = (root.innerText || root.textContent || '').trim();
          var uploading = deepQuery('[class*="upload"][class*="progress"]') ||
                          deepQuery('[class*="uploading"]') ||
                          deepQuery('[class*="transcoding"]') ||
                          deepQuery('.weui-desktop-upload__status');

          var preview = deepQuery('video') ||
                        deepQuery('[class*="preview-video"]') ||
                        deepQuery('[class*="video-thumb"]') ||
                        deepQuery('[class*="video"][class*="preview"]');

          var uploadFailed = deepQuery('[class*="upload-fail"]') || deepQuery('[class*="upload-error"]');
          if (uploadFailed || /上传失败|转码失败|处理失败/.test(bodyText)) return { done: false, failed: true };

          var hasFileEvidence = fileName && bodyText.indexOf(fileName) >= 0;
          var hasSuccessText = /上传成功|转码完成|处理完成/.test(bodyText);
          return { done: !uploading && (!!preview || hasFileEvidence || hasSuccessText), failed: false };
        })(${JSON.stringify(fileName)})
      `);
    } catch (err) {
      // Bridge may temporarily disconnect when the page re-renders after file is set.
      // Wait and retry rather than aborting.
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('ECONNRESET') || msg.includes('fetch failed')) {
        process.stderr.write(`  [retry] bridge reconnecting after page re-render (${i + 1}/${maxAttempts})...\n`);
        await page.wait({ time: pollMs / 1000 });
        continue;
      }
      throw err;
    }

    if (done?.failed) {
      throw new CommandExecutionError('视频上传失败，请检查文件格式和网络连接');
    }
    if (done?.done) return;

    await page.wait({ time: pollMs / 1000 });
  }

  throw new CommandExecutionError(`视频上传/转码超时（${Math.ceil(maxMs / 1000)}秒），请检查网络或稍后重试`);
}

// ── Helper: fill text field (with shadow DOM traversal) ─────────────────────
async function fillField(page, selectors, text, fieldName) {
  const result = await evalPage(page, `
    (function(selectors, text) {
      ${DEEP_QUERY_FN}

      var el = null;
      var foundSel = null;
      for (var i = 0; i < selectors.length; i++) {
        var candidate = deepQuery(selectors[i]);
        if (candidate && isVisible(candidate)) {
          el = candidate;
          foundSel = selectors[i];
          break;
        }
      }
      if (!el) return { ok: false };

      el.focus();

      if (el.isContentEditable) {
        // Clear existing content
        el.textContent = '';
        // Place cursor and insert text
        var sel = window.getSelection();
        var range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        if (sel) { sel.removeAllRanges(); sel.addRange(range); }
        var inserted = document.execCommand('insertText', false, text);
        if (!inserted) el.textContent = text;
        el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        var nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value') && Object.getOwnPropertyDescriptor(proto, 'value').set;
        if (nativeSetter) {
          nativeSetter.call(el, text);
        } else {
          el.value = text;
        }
        el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }

      var actual = el.isContentEditable ? (el.innerText || el.textContent || '') : (el.value || '');
      el.blur();
      return { ok: actual.indexOf(text) >= 0, sel: foundSel, actual: actual };
    })(${JSON.stringify(selectors)}, ${JSON.stringify(text)})
  `);

  if (!result?.ok) {
    await page.screenshot({ path: `/tmp/wechat-channels_publish_${fieldName}_debug.png` });
    throw new CommandExecutionError(
      `找不到 ${fieldName} 输入框，截图已保存到 /tmp/wechat-channels_publish_${fieldName}_debug.png`
    );
  }
}

// ── Helper: set schedule time ────────────────────────────────────────────────
async function setScheduleTime(page, dt) {
  // Parse target date
  const targetYear  = dt.getFullYear();
  const targetMonth = dt.getMonth() + 1;
  const targetDay   = dt.getDate();
  const targetHour  = dt.getHours();
  const targetMin   = dt.getMinutes();
  const pad = n => String(n).padStart(2, '0');

  // WeChat Channels uses the WeUI desktop date-time picker (class
  // `weui-desktop-picker__date-time`). Its real structure (verified against the
  // live DOM) is NOT a generic calendar:
  //   • Day cells are <a href="javascript:;"> inside <td>, NOT the <td> itself.
  //     The disabled state lives on the <a> (`weui-desktop-picker__disabled`),
  //     and out-of-month days carry `weui-desktop-picker__faded`.
  //   • Month nav arrows are `.weui-desktop-btn__icon__left/right`, scoped
  //     inside the date <dl>. The left arrow is hidden when you can't go back.
  //   • There is NO <input type="time">. Time is picked by clicking <li> items
  //     in `ol.weui-desktop-picker__time__hour` and `__minute`.
  //   • No 确定 button is needed — picking day + hour + minute updates the
  //     readonly display input live.
  // All steps run in ONE async evaluate: separate calls let the session lease
  // idle out and reset the tab to about:blank between commands.
  const result = await evalPage(page, `
    (async function(TY, TM, TD, TH, TMin) {
      ${DEEP_QUERY_FN}
      function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }
      function click(el) {
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
        el.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true, cancelable: true, view: window }));
        el.dispatchEvent(new MouseEvent('click',     { bubbles: true, cancelable: true, view: window }));
      }
      var pad = function(n) { return String(n).padStart(2, '0'); };

      // 1. Select the "定时" radio (exact match — "不定时" also contains "定时").
      var labels = deepQueryAll('label');
      var radioOk = false;
      for (var i = 0; i < labels.length; i++) {
        if ((labels[i].innerText || labels[i].textContent || '').trim() === '定时') {
          click(labels[i]);
          labels[i].click();
          radioOk = true;
          break;
        }
      }
      if (!radioOk) return { ok: false, reason: 'no-radio' };
      await sleep(600);

      // 2. Locate the date <dl> and open its panel.
      var dateDl = deepQuery('dl.weui-desktop-picker__date');
      if (!dateDl) return { ok: false, reason: 'no-date-dl' };
      var dateDt = dateDl.querySelector('dt.weui-desktop-picker__dt');
      if (!dateDt) return { ok: false, reason: 'no-date-dt' };
      click(dateDt);
      await sleep(500);

      // 3. Navigate months until the panel labels read TY年 TM月.
      var reached = false;
      for (var nav = 0; nav < 24; nav++) {
        var lbls = Array.prototype.map.call(
          dateDl.querySelectorAll('.weui-desktop-picker__panel__label'),
          function(l) { return (l.innerText || '').trim(); }
        );
        var ma = lbls.join('').match(/(\\d{4})年\\s*(\\d{1,2})月/);
        if (!ma) return { ok: false, reason: 'label-parse', labels: lbls.join('|') };
        var cy = parseInt(ma[1], 10), cm = parseInt(ma[2], 10);
        if (cy === TY && cm === TM) { reached = true; break; }
        var goNext = (cy < TY) || (cy === TY && cm < TM);
        var arrow = goNext
          ? dateDl.querySelector('.weui-desktop-btn__icon__right')
          : dateDl.querySelector('.weui-desktop-btn__icon__left');
        if (!arrow) return { ok: false, reason: 'no-arrow', cy: cy, cm: cm };
        click(arrow);
        await sleep(350);
      }
      if (!reached) return { ok: false, reason: 'month-not-reached' };

      // 4. Click the target day — an <a> in the body that is neither faded
      //    (other month) nor disabled (past).
      var bd = dateDl.querySelector('.weui-desktop-picker__panel__bd');
      var anchors = bd ? Array.prototype.slice.call(bd.querySelectorAll('a')) : [];
      var dayEl = null;
      for (var k = 0; k < anchors.length; k++) {
        var t = (anchors[k].innerText || anchors[k].textContent || '').trim();
        var cls = anchors[k].className || '';
        if (t === String(TD) && cls.indexOf('faded') < 0 && cls.indexOf('disabled') < 0) {
          dayEl = anchors[k];
          break;
        }
      }
      if (!dayEl) return { ok: false, reason: 'day-disabled-or-missing', day: TD };
      click(dayEl);
      await sleep(500);

      // 5. Open the time <dl> and pick hour + minute from the <li> columns.
      var timeDl = deepQuery('dl.weui-desktop-picker__time');
      if (!timeDl) return { ok: false, reason: 'no-time-dl' };
      var timeDt = timeDl.querySelector('dt.weui-desktop-picker__dt');
      if (timeDt) click(timeDt);
      await sleep(500);

      function pickFromColumn(ol, value) {
        if (!ol) return false;
        var lis = ol.querySelectorAll('li');
        for (var i = 0; i < lis.length; i++) {
          if ((lis[i].innerText || '').trim() === value &&
              (lis[i].className || '').indexOf('disabled') < 0) {
            click(lis[i]);
            return true;
          }
        }
        return false;
      }
      var hourOk = pickFromColumn(timeDl.querySelector('ol.weui-desktop-picker__time__hour'), pad(TH));
      if (!hourOk) return { ok: false, reason: 'hour-disabled', hour: TH };
      await sleep(300);
      var minOk = pickFromColumn(timeDl.querySelector('ol.weui-desktop-picker__time__minute'), pad(TMin));
      if (!minOk) return { ok: false, reason: 'minute-disabled', minute: TMin };
      await sleep(300);

      // 6. Read back the display input to confirm the value landed.
      var inp = deepQuery('input[placeholder*="发表时间"]');
      return { ok: true, value: inp ? inp.value : null };
    })(${targetYear}, ${targetMonth}, ${targetDay}, ${targetHour}, ${targetMin})
  `);

  if (!result?.ok) {
    await page.screenshot({ path: '/tmp/wechat-channels_schedule_debug.png' });
    const reason = result?.reason ? String(result.reason) : 'empty picker result';
    throw new CommandExecutionError(
      `定时设置失败 (${reason})，截图: /tmp/wechat-channels_schedule_debug.png`,
    );
  }

  const expected = `${targetYear}-${pad(targetMonth)}-${pad(targetDay)} ${pad(targetHour)}:${pad(targetMin)}`;
  if (!String(result.value || '').includes(expected)) {
    throw new CommandExecutionError(`定时设置未验证成功: expected=${expected} actual=${result.value || ''}`);
  }
  process.stderr.write(`  定时设置完成: ${result.value || expected}\n`);
}

// ── Helper: click publish or draft button ────────────────────────────────────
async function clickPublish(page, isDraft) {
  const labels = isDraft
    ? ['存草稿', '保存草稿', '草稿']
    : ['发表', '发布'];

  const clicked = await evalPage(page, `
    (function(labels) {
      ${DEEP_QUERY_FN}
      var btns = deepQueryAll('button');
      for (var i = 0; i < btns.length; i++) {
        var btn = btns[i];
        var text = (btn.innerText || btn.textContent || '').trim();
        var isDisabled = btn.disabled || btn.getAttribute('disabled') !== null ||
                         btn.classList.contains('weui-desktop-btn_disabled');
        if (!isDisabled && isVisible(btn)) {
          for (var j = 0; j < labels.length; j++) {
            if (text === labels[j] || text.includes(labels[j])) {
              btn.click();
              return { ok: true, text: text };
            }
          }
        }
      }
      return { ok: false };
    })(${JSON.stringify(labels)})
  `);

  if (!clicked?.ok) {
    await page.screenshot({ path: '/tmp/wechat-channels_publish_submit_debug.png' });
    throw new CommandExecutionError(
      `找不到"${labels[0]}"按钮（按钮可能被禁用或表单未完成），` +
      '截图已保存到 /tmp/wechat-channels_publish_submit_debug.png'
    );
  }
  return clicked;
}

// ── Main cli registration ──────────────────────────────────────────────────
cli({
  site: 'wechat-channels',
  name: 'publish',
  access: 'write',
  description: '发布视频到视频号',
  domain: 'channels.weixin.qq.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'video',    required: true,  positional: true, help: '视频文件路径 (.mp4/.mov/.avi/.webm)' },
    { name: 'title',    required: false, help: '短标题（建议 6-16 字）' },
    { name: 'caption',  required: false, help: '描述内容，支持直接写 #话题（如：日常生活 #搞笑 #生活）' },
    { name: 'schedule', required: false, help: '定时发布时间（ISO8601 或 Unix 秒，如 "2026-05-20 10:00"）' },
    { name: 'draft',    type: 'bool', default: false, help: '保存为草稿' },
    { name: 'manual',   type: 'bool', default: false, help: '填完所有字段后不自动发布，由用户手动点击发表（务必同时传 --site-session persistent，否则表单页约 30 秒后会被重置为空白页）' },
    { name: 'timeout',  type: 'int', required: false, default: 600, help: '命令整体超时秒数（含登录等待 + 上传转码，默认 600）' },
  ],
  columns: ['status', 'title', 'detail'],
  func: async (page, kwargs) => {
    if (!page) throw new CommandExecutionError('需要浏览器页面');

    // ── 1. Validate inputs ───────────────────────────────────────────────
    const timeoutSeconds = parseTimeoutSeconds(kwargs.timeout);
    const deadline = Date.now() + timeoutSeconds * 1000;
    const videoPath = requireFilePath(kwargs.video, '视频', VIDEO_EXTENSIONS);

    const title = String(kwargs.title ?? '').trim();
    const caption = String(kwargs.caption ?? '').trim();
    const scheduleTime = parseScheduleDate(kwargs.schedule || null);
    const isDraft = parseBooleanFlag(kwargs.draft);
    const isManual = parseBooleanFlag(kwargs.manual);

    // ── 2. Navigate to creator center ────────────────────────────────────
    await page.goto(PUBLISH_URL);
    await page.wait({ time: 4 }); // wujie needs extra time to bootstrap

    // ── 3. Login check — fallback: navigate to login page and wait ───────
    {
      const urlAfterNav = await evalPage(page, '() => location.href');
      if (urlAfterNav.includes(LOGIN_PATH_FRAGMENT)) {
        process.stderr.write(
          '\n⚠️  未登录视频号。已跳转到登录页，请在 Chrome 中扫码登录...\n' +
          '   登录完成后将自动继续发布。\n\n'
        );

        const loginDeadline = Math.min(deadline, Date.now() + 120_000);
        let loggedIn = false;
        while (Date.now() < loginDeadline) {
          await page.wait({ time: 3 });
          const url = await evalPage(page, '() => location.href');
          if (!url.includes(LOGIN_PATH_FRAGMENT)) {
            loggedIn = true;
            break;
          }
          process.stderr.write('   等待扫码中...\n');
        }

        if (!loggedIn) {
          throw new AuthRequiredError('channels.weixin.qq.com', '登录超时（2分钟），请手动登录后重试');
        }

        process.stderr.write('✅ 登录成功，继续发布...\n\n');
        await page.wait({ time: 3 }); // let bridge stabilize after login redirect
        await page.goto(PUBLISH_URL);
        await page.wait({ time: 5 });
      }
    }

    // ── 4. Upload video ──────────────────────────────────────────────────
    await uploadFile(page, videoPath);
    await page.wait({ time: 2 });

    // ── 5. Wait for upload + transcode done ──────────────────────────────
    await waitForUploadDone(page, path.basename(videoPath), Math.min(180_000, remainingMs(deadline, '视频上传/转码')));
    await page.wait({ time: 1 });

    // ── 6. Fill title (主要内容) ─────────────────────────────────────────
    if (title) {
      await fillField(page, TITLE_SELECTORS, title, 'title');
      await page.wait({ time: 0.5 });
    }

    // ── 7. Fill caption (描述 + 话题) ────────────────────────────────────
    if (caption) {
      await fillField(page, DESC_SELECTORS, caption, 'caption');
      await page.wait({ time: 0.5 });
    }

    // ── 8. Set schedule time (optional) ──────────────────────────────────
    if (scheduleTime) {
      await setScheduleTime(page, scheduleTime);
      await page.wait({ time: 0.5 });
    }

    // ── 9. Publish or save draft ──────────────────────────────────────────
    if (isManual) {
      // The owned automation tab is reset to about:blank when its lease is
      // released — immediately if --keep-tab is not set, or after the ~30s
      // idle timeout otherwise. Only --site-session persistent disables that
      // reset entirely (it maps to IDLE_TIMEOUT_NONE in the extension). Manual
      // review always exceeds 30s, so warn unless the form will actually
      // survive. We can't read the resolved siteSession from here, so the
      // guidance is unconditional.
      process.stderr.write(
        '\n  ℹ️  手动模式：表单已填好，请在浏览器中检查并点击「发表」。\n' +
        '     若未加 --site-session persistent，此标签页约 30 秒后会被重置为空白页。\n\n'
      );
      return [{
        status: '⏸️ 已填写完毕，请在浏览器中手动点击发表',
        title: title || '',
        detail: [
          scheduleTime ? `定时: ${scheduleTime}` : null,
        ].filter(Boolean).join(' · ') || '表单已就绪',
      }];
    }

    await clickPublish(page, isDraft);

    // ── 10. Verify result ─────────────────────────────────────────────────
    await page.wait({ time: 4 });
    const finalUrl = await evalPage(page, '() => location.href');

    const successMarkers = isDraft
      ? ['草稿已保存', '暂存成功', '保存成功']
      : ['已发表', '发布成功', '发表成功', '审核中'];

    const successMsg = await evalPage(page, `
      (function(markers) {
        ${DEEP_QUERY_FN}
        var all = deepQueryAll('*');
        for (var i = 0; i < all.length; i++) {
          var el = all[i];
          var text = (el.innerText || '').trim();
          if (el.children.length === 0 && text) {
            for (var j = 0; j < markers.length; j++) {
              if (text.includes(markers[j])) return text;
            }
          }
        }
        return '';
      })(${JSON.stringify(successMarkers)})
    `);

    const isSuccess = submitSucceeded({ isDraft, finalUrl, successMsg });
    if (!isSuccess) {
      await page.screenshot({ path: '/tmp/wechat-channels_publish_result_debug.png' });
      throw new CommandExecutionError(
        `未能验证${isDraft ? '草稿保存' : '发布'}成功，截图已保存到 /tmp/wechat-channels_publish_result_debug.png`,
        `url=${finalUrl || ''} message=${successMsg || ''}`,
      );
    }

    const verb = isDraft ? '草稿已保存' : '发布成功';
    const detailParts = [
      scheduleTime ? `定时: ${scheduleTime.toISOString()}` : null,
      successMsg || finalUrl,
    ].filter(Boolean);

    const result = [{
      status: `✅ ${verb}`,
      title: title || '',
      detail: detailParts.join(' · ') || finalUrl,
    }];

    // Leave the tab on the post list rather than the (now-submitted) create
    // form. NOTE: under the default ephemeral lifecycle the extension releases
    // the owned tab right after this command returns and resets it to
    // about:blank, so this navigation is only visible with
    // --site-session persistent (or --keep-tab, until the ~30s idle timeout).
    // It is harmless either way.
    await page.goto('https://channels.weixin.qq.com/platform/post/list', { waitUntil: 'none' }).catch(() => {});

    return result;
  },
});
