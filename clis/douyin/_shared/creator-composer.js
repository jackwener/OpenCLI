/**
 * Image/article creator UI, observed 2026-11-08.
 * No private API replay, cookie extraction, automatic publishing or submit retries.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ArgumentError, AuthRequiredError, CliError, CommandExecutionError } from '@jackwener/opencli/errors';
import { requireObjectEvaluateResult } from './evaluate-result.js';

export const IMAGE_UPLOAD_URL = 'https://creator.douyin.com/creator-micro/content/upload?default-tab=3';
export const ARTICLE_URL = 'https://creator.douyin.com/creator-micro/content/post/article?default-tab=3&enter_from=publish_page&media_type=article&type=new';
const VISIBILITY = { public: '公开', friends: '好友可见', private: '仅自己可见' };
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const TITLE = { image: 'input[placeholder="添加作品标题"]', article: 'input[placeholder*="请输入文章标题"]' };
const BODY = '[contenteditable="true"]';
const PICKER_MARKER = 'data-opencli-douyin-file';

export function validateImage(filename) {
    if (typeof filename !== 'string' || !filename.trim()) throw new ArgumentError('需要图片文件路径');
    const resolved = path.resolve(filename);
    if (!IMAGE_EXTENSIONS.has(path.extname(resolved).toLowerCase())) {
        throw new ArgumentError('图片仅支持 jpg、jpeg、png、webp（不支持 GIF）');
    }
    let info;
    try { info = fs.statSync(resolved); } catch { throw new ArgumentError('图片文件不存在或不可读'); }
    if (!info.isFile() || info.size === 0 || info.size > 50 * 1024 * 1024) {
        throw new ArgumentError('图片必须是非空普通文件，且不能超过 50MB');
    }
    return resolved;
}

export function validateOptions(kind, args) {
    const title = String(args.title ?? '').trim();
    const titleLimit = kind === 'image' ? 20 : 30;
    // Match the editor's JS length counter, including surrogate pairs.
    if (!title || title.length > titleLimit) throw new ArgumentError(`标题需要 1–${titleLimit} 字`);
    if (args.publish && args['save-draft']) throw new ArgumentError('--publish 与 --save-draft 不能同时使用');
    if (!(args.visibility in VISIBILITY)) throw new ArgumentError('不支持的可见范围');
    const options = { kind, title, visibility: args.visibility, publish: args.publish === true, saveDraft: args['save-draft'] === true };
    if (kind === 'image') {
        const images = String(args.images ?? '').split(',').map(v => v.trim()).filter(Boolean);
        if (!images.length || images.length > 35) throw new ArgumentError('图文需要 1–35 张图片，以逗号分隔路径');
        options.images = images.map(validateImage);
        if (new Set(options.images).size !== options.images.length) throw new ArgumentError('图片路径不能重复');
        options.body = String(args.caption ?? '');
        if (options.body.length > 1000) throw new ArgumentError('图文正文不能超过 1000 字');
    } else {
        let info;
        const bodyPath = path.resolve(String(args['body-file'] ?? ''));
        try { info = fs.statSync(bodyPath); } catch { throw new ArgumentError('文章正文文件不存在或不可读'); }
        if (!info.isFile() || info.size > 100000) throw new ArgumentError('文章正文必须是 ≤100KB 的 UTF-8 文本文件');
        options.body = fs.readFileSync(bodyPath, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
        if (!options.body.trim() || options.body.length > 20000 || options.body.includes('\uFFFD') || options.body.includes('\0')) {
            throw new ArgumentError('文章正文需要 1–20000 字有效 UTF-8 纯文本');
        }
        options.summary = String(args.summary ?? '').trim();
        if (options.summary.length > 30) throw new ArgumentError('文章摘要不能超过 30 字');
        options.cover = args.cover ? validateImage(args.cover) : '';
        if ((options.publish || options.saveDraft) && !options.cover) throw new ArgumentError('提交或保存文章前必须提供 --cover');
    }
    return options;
}

function object(result) {
    return requireObjectEvaluateResult(result, '抖音编辑器返回无效状态');
}

export async function readState(page, kind) {
    return object(await page.evaluate(`(() => {
      const text = document.body?.innerText || '';
      const href = location.href;
      const anyComposer = /^\\/creator-micro\\/content\\/post\\/(image|article|video)$/.test(location.pathname);
      const title = document.querySelector(${JSON.stringify(TITLE[kind])});
      const editors = [...document.querySelectorAll('[contenteditable="true"]')];
      const imageCounters = [...document.querySelectorAll('[class^="info-"]')].filter(e =>
        [...e.querySelectorAll('button')].some(b=>b.textContent.trim() === '继续添加'));
      const counterText = imageCounters.length === 1 ? [...imageCounters[0].childNodes]
        .filter(n=>n.nodeType === Node.TEXT_NODE).map(n=>n.textContent).join('') : '';
      const match = counterText.match(/^\\s*已添加\\s*(\\d+)\\s*张图片\\s*$/);
      const alerts = [...document.querySelectorAll(
        '[role="dialog"],[role="alert"],[class*="message"],[class*="toast"],[class*="login"],[id*="login"],[class*="captcha"],[id*="captcha"]'
      )].filter(e=>e.getClientRects().length && !e.closest('[contenteditable]'));
      const challengeText = anyComposer ? alerts.map(e=>e.innerText).join('\\n') : text;
      const receipts = [...document.querySelectorAll('[role="alert"],[class*="message"],[class*="toast"]')]
        .filter(e=>!e.hasAttribute('data-opencli-before-submit') && e.getClientRects().length &&
          !e.closest('[contenteditable]')).map(e=>e.textContent.trim());
      const labels = [...document.querySelectorAll('label')];
      const visibility = labels.filter(e => e.querySelector('input:checked')).map(e => e.textContent.trim());
      return {
        trusted: location.origin === 'https://creator.douyin.com',
        composer: location.pathname === '/creator-micro/content/post/${kind}',
        anyComposer,
        anyTitle: document.querySelector('input[placeholder*="标题"]')?.value || '',
        anyMedia: !!document.querySelector('[class*="content-upload"] img[src],video[src]'),
        title: title?.value || '',
        body: editors.length === 1 ? (
          ${JSON.stringify(kind)} === 'article' && editors[0].children.length &&
            [...editors[0].children].every(e=>e.tagName === 'P')
            ? [...editors[0].children].map(e=>e.textContent).join('\\n')
            : editors[0].innerText
        ).replace(/\\u200b/g, '') : '',
        editorCount: editors.length,
        summary: document.querySelector('input[placeholder*="添加内容摘要"]')?.value || '',
        imageCount: match ? Number(match[1]) : 0,
        uploadReady: !!document.querySelector('input[type="file"][multiple]'),
        visibility,
        coverReady: !!document.querySelector('[data-opencli-douyin-cover-section] [class*="content-upload"] img'),
        coverDecoded: [...document.querySelectorAll('[class*="modalContainer"] img')]
          .some(e=>e.complete && e.naturalWidth > 256),
        coverDialog: text.includes('编辑封面') && [...document.querySelectorAll('button')].some(e => e.textContent.trim() === '完成'),
        security: /验证码|安全验证|操作频繁|访问频次异常|安全限制/.test(challengeText) || /captcha/i.test(href),
        login: /\\/passport|\\/login/.test(href) || /扫码登录|登录抖音创作者中心/.test(challengeText),
        publishSuccess: receipts.some(t=>/^(发布成功|作品发布成功|已提交审核)$/.test(t)),
        draftSuccess: receipts.some(t=>/^(保存成功|草稿保存成功)$/.test(t)),
        management: location.pathname === '/creator-micro/content/manage'
      };
    })()`));
}

function checkState(state) {
    if (state.security) throw new CliError('SECURITY_BLOCK', '抖音要求安全验证；请人工处理，停止自动重试');
    if (state.login || !state.trusted) throw new AuthRequiredError('creator.douyin.com', '请在当前 Chrome Profile 登录抖音创作者中心');
}

export async function waitState(page, kind, predicate, message, attempts = 60) {
    for (let i = 0; i < attempts; i++) {
        const state = await readState(page, kind);
        checkState(state);
        if (predicate(state)) return state;
        await page.wait({ time: 0.5 });
    }
    throw new CommandExecutionError(message);
}

async function fill(page, selector, value) {
    if (selector === BODY && typeof page.insertText === 'function') {
        // Douyin's image editor appends a zero-width leaf. The generic fillText
        // verifier can mistake it for a mismatch and run a destructive DOM
        // fallback. Use native input once, then our normalized editor readback.
        const selected = await page.evaluate(`(() => {
          const elements = document.querySelectorAll('[contenteditable="true"]');
          if (elements.length !== 1) return false;
          const editor = elements[0];
          editor.focus();
          const range = document.createRange();
          range.selectNodeContents(editor);
          const selection = window.getSelection();
          selection.removeAllRanges(); selection.addRange(range);
          return true;
        })()`);
        if (selected !== true) throw new CommandExecutionError('抖音正文编辑器不唯一；未提交');
        await page.insertText(value);
        return;
    }
    const result = await page.fillText(selector, value);
    if (!result?.verified) throw new CommandExecutionError('抖音编辑器未确认文本写入；未提交');
}

/**
 * Article cover uses an unattached input created inside the click handler.
 * Retain only that input for CDP, restore the native method synchronously.
 * Never replace onChange, export files, invoke framework internals or leave patches installed.
 */
export function buildRetainCoverInputJs() {
    return `(() => {
      const sections = [...document.querySelectorAll('div[class*="content-"]')].filter(e =>
        [...e.children].some(c => c.textContent.replace(/\\s|\\*/g, '') === '封面设置'));
      const section = sections.sort((a,b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length)[0];
      if (!section) return { ok: false };
      section.setAttribute('data-opencli-douyin-cover-section','1');
      const trigger = section.querySelector('[class^="addIcon-"]');
      if (!trigger) return { ok: false };
      const prototype = HTMLInputElement.prototype;
      const original = prototype.click;
      try {
        prototype.click = function() {
          if (this.type === 'file') {
            this.setAttribute('${PICKER_MARKER}','1');
            this.style.display = 'none';
            document.body.appendChild(this);
          } else { return original.call(this); }
        };
        trigger.click();
      } finally { prototype.click = original; }
      return { ok: !!document.querySelector('input[${PICKER_MARKER}="1"]') };
    })()`;
}

async function uploadCover(page, cover) {
    const result = object(await page.evaluate(buildRetainCoverInputJs()));
    if (!result.ok) throw new CommandExecutionError('未找到文章封面上传入口；未提交');
    try {
        await page.setFileInput([cover], `input[${PICKER_MARKER}="1"]`);
        await waitState(page, 'article', s => s.coverDialog && s.coverDecoded, '文章封面图片尚未解码完成');
        await page.wait({ time: 1 });
        await clickExact(page, '完成');
        await waitState(page, 'article', s => !s.coverDialog && s.coverReady, '文章封面未完成上传或裁剪');
    } finally {
        await page.evaluate(`document.querySelectorAll('input[${PICKER_MARKER}="1"]').forEach(e=>e.remove())`).catch(() => {});
    }
}

export async function clickExact(page, text, once = false) {
    const evaluate = once ? page.evaluateOnce : page.evaluate;
    if (typeof evaluate !== 'function') throw new CommandExecutionError('浏览器不支持不重放的提交；未调用发布按钮');
    const result = object(await evaluate.call(page, `(() => {
      const matches = [...document.querySelectorAll('button')].filter(e =>
        e.textContent.trim() === ${JSON.stringify(text)} && e.getClientRects().length && !e.disabled);
      if (matches.length !== 1) return { ok: false };
      matches[0].click();
      return { ok: true };
    })()`));
    if (!result.ok) throw new CommandExecutionError('无法唯一识别抖音操作按钮；未自动重试');
}

async function setVisibility(page, visibility) {
    const result = object(await page.evaluate(`(() => {
      const matches = [...document.querySelectorAll('label')].filter(e =>
        e.textContent.trim() === ${JSON.stringify(VISIBILITY[visibility])} && e.querySelector('input'));
      if (matches.length !== 1) return { ok: false };
      const input = matches[0].querySelector('input');
      if (!input.checked) matches[0].click();
      return { ok: true };
    })()`));
    if (!result.ok) throw new CommandExecutionError('无法唯一确认可见范围；未提交');
}

export function verifyComposer(state, options) {
    checkState(state);
    if (!state.composer || state.title !== options.title || state.body.trim() !== options.body.trim() ||
        (options.kind === 'image' && state.imageCount !== options.images.length) ||
        (options.kind === 'article' && (state.summary !== options.summary || (options.cover && !state.coverReady))) ||
        state.visibility.filter(value => Object.values(VISIBILITY).includes(value)).length !== 1 ||
        !state.visibility.includes(VISIBILITY[options.visibility]) ||
        !state.visibility.includes('立即发布')) {
        throw new CommandExecutionError('抖音编辑器回读与请求不一致；未提交');
    }
}

export async function runComposer(page, options) {
    if (typeof page.setFileInput !== 'function' || typeof page.fillText !== 'function') {
        throw new CommandExecutionError('需要支持文件上传与文本回读的 Browser Bridge');
    }
    // Do not replace an in-progress user/previous preparation in this leased tab.
    const initial = await readState(page, options.kind);
    if (initial.anyComposer && (
        initial.anyTitle || initial.body.trim() || initial.imageCount ||
        initial.summary || initial.anyMedia || initial.coverDialog
    )) {
        throw new CommandExecutionError('当前标签有未提交编辑；请先人工处理，或为本次操作使用独立会话');
    }
    await page.goto(options.kind === 'image' ? IMAGE_UPLOAD_URL : ARTICLE_URL);
    if (options.kind === 'image') {
        await waitState(page, options.kind, s => s.uploadReady, '等待抖音图片上传入口超时');
        await page.setFileInput(options.images, 'input[type="file"][multiple]');
    }
    await waitState(page, options.kind,
        s => s.composer && s.editorCount === 1 && (options.kind !== 'image' || s.imageCount === options.images.length),
        '等待抖音图文/文章编辑器和图片上传超时');
    await fill(page, TITLE[options.kind], options.title);
    await fill(page, BODY, options.body);
    if (options.kind === 'article') {
        await fill(page, 'input[placeholder*="添加内容摘要"]', options.summary);
        if (options.cover) await uploadCover(page, options.cover);
    }
    await setVisibility(page, options.visibility);
    // React state and uploaded-cover rendering settle before authoritative readback.
    await page.wait({ time: 0.5 });
    verifyComposer(await readState(page, options.kind), options);
    const base = { kind: options.kind, title: options.title, visibility: options.visibility };
    if (!options.publish && !options.saveDraft) {
        return [{ ...base, status: 'prepared', submitted: false,
            message: '已填写并回读，尚未发布或保存草稿；检查编辑器后人工提交，或在新会话显式指定 --publish/--save-draft' }];
    }
    if (typeof page.evaluateOnce !== 'function') {
        throw new CommandExecutionError('当前浏览器后端缺少 evaluateOnce；已准备预览，但未提交');
    }
    // One click only. Transport failure after this point is NEVER safely retryable.
    try {
        await page.evaluate(`document.querySelectorAll('[role="alert"],[class*="message"],[class*="toast"]')
          .forEach(e=>e.setAttribute('data-opencli-before-submit','1'))`);
        await clickExact(page, options.publish ? '发布' : '暂存离开', true);
        for (let i = 0; i < 40; i++) {
            await page.wait({ time: 0.5 });
            const state = await readState(page, options.kind);
            checkState(state);
            const receiptMatches = options.publish ? state.publishSuccess : state.draftSuccess;
            if (receiptMatches && (state.management || !state.composer)) {
                return [{ ...base, status: options.publish ? 'submitted' : 'draft_saved',
                    submitted: options.publish, verification: 'platform_ui',
                    message: options.publish ? '平台确认已提交，仍需审核；不代表已公开可见' : '平台确认草稿已保存' }];
            }
        }
    } catch { /* Never expose platform bodies/credentials, never resubmit. */ }
    return [{ ...base, status: 'uncertain', submitted: null, retryable: false,
        message: '已尝试提交但未取得明确回执；请在创作中心人工核验，禁止直接重试' }];
}
