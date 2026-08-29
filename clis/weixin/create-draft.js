import fs from 'node:fs';
import path from 'node:path';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CliError, CommandExecutionError } from '@jackwener/opencli/errors';

const WEIXIN_DOMAIN = 'mp.weixin.qq.com';
const WEIXIN_HOME = 'https://mp.weixin.qq.com/';
const IMAGE_FILE_INPUT_SELECTOR = 'input[type="file"][name="file"]';
const IMAGE_MIME_TYPES = new Map([
    ['.jpg', 'image/jpeg'],
    ['.jpeg', 'image/jpeg'],
    ['.png', 'image/png'],
    ['.gif', 'image/gif'],
    ['.webp', 'image/webp'],
]);

function unwrapEvaluateResult(payload) {
    if (payload && typeof payload === 'object' && typeof payload.session === 'string' && Object.hasOwn(payload, 'data')) {
        return payload.data;
    }
    return payload;
}

async function evaluate(page, script) {
    return unwrapEvaluateResult(await page.evaluate(script));
}

function isRecoverableFileInputError(error) {
    const message = error instanceof Error ? error.message : String(error);
    return /unknown action|not supported|not[-\s]?allowed|notallowederror/i.test(message);
}

function resolveCoverImage(rawPath) {
    const value = String(rawPath ?? '').trim();
    if (!value) throw new ArgumentError('weixin create-draft cover-image cannot be empty');
    const absPath = path.resolve(value);
    let stat;
    try {
        stat = fs.statSync(absPath);
    } catch {
        throw new ArgumentError(`weixin create-draft cover-image does not exist: ${absPath}`);
    }
    if (!stat.isFile()) {
        throw new ArgumentError(`weixin create-draft cover-image is not a file: ${absPath}`);
    }
    const extension = path.extname(absPath).toLowerCase();
    const mimeType = IMAGE_MIME_TYPES.get(extension);
    if (!mimeType) {
        throw new ArgumentError('weixin create-draft cover-image must be JPEG, PNG, GIF, or WebP');
    }
    return { absPath, fileName: path.basename(absPath), mimeType };
}

async function navigateToEditor(page) {
    await page.goto(WEIXIN_HOME);
    await page.wait(3);
    const token = await evaluate(page, `(window.location.href.match(/token=(\\d+)/)||[])[1]`);
    if (!token) {
        throw new AuthRequiredError(WEIXIN_DOMAIN, 'Please log in to the WeChat Official Account platform and retry.');
    }
    await page.goto(`https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=77&token=${token}&lang=zh_CN`);
    await page.wait(4);
    const hasTitle = await evaluate(page, '!!document.querySelector("textarea#title")');
    if (hasTitle !== true) {
        throw new CommandExecutionError('WeChat article editor did not load. The session may have expired.');
    }
}

async function fillField(page, selector, value) {
    return evaluate(page, `(() => {
        var el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return { ok: false, reason: 'field not found' };
        el.focus();
        var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        var setter = Object.getOwnPropertyDescriptor(proto, 'value');
        if (setter && setter.set) setter.set.call(el, ${JSON.stringify(value)});
        else el.value = ${JSON.stringify(value)};
        el.dispatchEvent(new InputEvent('input', { bubbles: true, data: ${JSON.stringify(value)} }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.blur();
        return { ok: true };
    })()`);
}

async function fillContent(page, text) {
    return evaluate(page, `(() => {
        var editors = document.querySelectorAll('div[contenteditable="true"]');
        var editor = editors[editors.length - 1];
        if (!editor) return { ok: false, reason: 'content editor not found' };
        editor.focus();
        if (editor.querySelector('[contenteditable="false"]')) editor.innerHTML = '';
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, ${JSON.stringify(text)});
        editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
        return { ok: true };
    })()`);
}

async function readCdnImageKeys(page) {
    const keys = await evaluate(page, `(() => {
        var editor = document.querySelector('#ueditor_0');
        if (!editor) return [];
        return Array.from(editor.querySelectorAll('img')).map(function(img) {
            return img.getAttribute('data-src') || img.getAttribute('src') || '';
        }).filter(function(src) { return /(?:mmbiz|qpic\\.cn)/i.test(src); });
    })()`);
    if (!Array.isArray(keys)) {
        throw new CommandExecutionError('WeChat image upload returned a malformed editor image payload.');
    }
    return keys.map(String);
}

async function injectImageFile(page, image) {
    if (typeof page.setFileInput === 'function') {
        try {
            await page.setFileInput([image.absPath], IMAGE_FILE_INPUT_SELECTOR);
            return;
        } catch (error) {
            if (!isRecoverableFileInputError(error)) {
                const message = error instanceof Error ? error.message : String(error);
                throw new CommandExecutionError(`WeChat image upload failed: ${message}`);
            }
        }
    }

    const base64 = fs.readFileSync(image.absPath).toString('base64');
    const fallback = await evaluate(page, `(() => {
        var input = document.querySelector(${JSON.stringify(IMAGE_FILE_INPUT_SELECTOR)});
        if (!input) return { ok: false, reason: 'image file input not found' };
        try {
            var binary = atob(${JSON.stringify(base64)});
            var bytes = new Uint8Array(binary.length);
            for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            var transfer = new DataTransfer();
            transfer.items.add(new File([bytes], ${JSON.stringify(image.fileName)}, { type: ${JSON.stringify(image.mimeType)} }));
            var descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'files');
            if (descriptor && descriptor.set) descriptor.set.call(input, transfer.files);
            else input.files = transfer.files;
            if (!input.files || input.files.length !== 1) return { ok: false, reason: 'file input rejected fallback file' };
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            return { ok: true };
        } catch (error) {
            return { ok: false, reason: String(error && error.message || error) };
        }
    })()`);
    if (!fallback?.ok) {
        throw new CommandExecutionError(`WeChat image upload fallback failed: ${fallback?.reason || 'unknown error'}`);
    }
}

async function uploadContentImage(page, image) {
    const previousKeys = await readCdnImageKeys(page);
    const opened = await evaluate(page, `(() => {
        var button = document.querySelector('#js_editor_insertimage');
        if (!button) return { ok: false, reason: 'insert-image button not found' };
        button.click();
        return { ok: true };
    })()`);
    if (!opened?.ok) throw new CommandExecutionError(`Could not open WeChat image upload: ${opened?.reason || 'unknown error'}`);
    await page.wait(1);

    const selected = await evaluate(page, `(() => {
        var item = document.querySelector('.js_img_dropdown_menu .tpl_dropdown_menu_item');
        if (!item) return { ok: false, reason: 'upload menu item not found' };
        item.click();
        return { ok: true };
    })()`);
    if (!selected?.ok) throw new CommandExecutionError(`Could not select WeChat image upload: ${selected?.reason || 'unknown error'}`);
    await page.wait(1);
    await injectImageFile(page, image);

    for (let attempt = 0; attempt < 15; attempt++) {
        await page.wait(2);
        const state = await evaluate(page, `(() => {
            var previous = new Set(${JSON.stringify(previousKeys)});
            var editor = document.querySelector('#ueditor_0');
            var images = editor ? Array.from(editor.querySelectorAll('img')) : [];
            var key = images.map(function(img) {
                return img.getAttribute('data-src') || img.getAttribute('src') || '';
            }).find(function(src) { return /(?:mmbiz|qpic\\.cn)/i.test(src) && !previous.has(src); });
            var errorText = Array.from(document.querySelectorAll('.weui-desktop-tips, .weui-desktop-toast, .js_msgSenderTips'))
                .filter(function(el) { return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length); })
                .map(function(el) { return (el.innerText || el.textContent || '').trim(); })
                .filter(Boolean).join('\\n');
            return { ok: !!key, errorText: errorText };
        })()`);
        if (state?.ok) return;
        if (state?.errorText && /(无法解析|上传失败|过大|频繁|不支持|错误)/.test(state.errorText)) {
            throw new CommandExecutionError(`WeChat image upload failed: ${state.errorText}`);
        }
    }
    throw new CommandExecutionError('WeChat image upload timed out before a new CDN image appeared in the editor.');
}

async function selectCoverFromContent(page) {
    await evaluate(page, 'document.querySelector("#js_cover_description_area")?.scrollIntoView()');
    await page.wait(1);
    await evaluate(page, 'document.querySelector(".js_cover_btn_area")?.click()');
    await page.wait(1);
    await evaluate(page, `(() => {
        var link = Array.from(document.querySelectorAll('a.pop-opr__button')).find(function(el) {
            return (el.textContent || '').trim() === '从正文选择';
        });
        if (link) link.click();
    })()`);
    await page.wait(2);
    await evaluate(page, `document.querySelector('.weui-desktop-dialog_img-picker .appmsg_content_img')?.click()`);
    await page.wait(1);
    await evaluate(page, `(() => {
        var button = Array.from(document.querySelectorAll('.weui-desktop-dialog_img-picker button')).find(function(el) {
            return (el.textContent || '').trim() === '下一步' && !el.disabled;
        });
        if (button) button.click();
    })()`);

    for (let attempt = 0; attempt < 8; attempt++) {
        await page.wait(2);
        const confirmed = await evaluate(page, `(() => {
            var button = Array.from(document.querySelectorAll('button')).find(function(el) {
                return (el.textContent || '').trim() === '确认' && !el.disabled && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
            });
            if (!button) return false;
            button.click();
            return true;
        })()`);
        if (confirmed === true) break;
    }

    await page.wait(2);
    return evaluate(page, `(() => {
        var area = document.querySelector('#js_cover_area');
        if (!area) return false;
        if (area.querySelector('img[src*="mmbiz"], img[src*="qpic.cn"], img[data-src*="mmbiz"], img[data-src*="qpic.cn"]')) return true;
        return Array.from(area.querySelectorAll('*')).some(function(el) {
            return /(?:mmbiz|qpic\\.cn)/i.test(window.getComputedStyle(el).backgroundImage || '');
        });
    })()`);
}

async function readSaveState(page) {
    return evaluate(page, `(() => {
        var elements = Array.from(document.querySelectorAll('#js_save_success, .weui-desktop-toast, .weui-desktop-tips'));
        var text = elements.filter(function(el) {
            return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
        }).map(function(el) {
            return (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
        }).find(function(value) { return /已保存|保存成功/.test(value); }) || '';
        return { visible: !!text, text: text };
    })()`);
}

async function saveDraft(page) {
    const before = await readSaveState(page);
    const result = await evaluate(page, `(() => {
        var button = Array.from(document.querySelectorAll('span, button, a')).find(function(el) {
            return (el.textContent || '').trim() === '保存为草稿' && !el.disabled;
        });
        if (!button) return { ok: false };
        button.click();
        return { ok: true };
    })()`);
    if (!result?.ok) throw new CommandExecutionError('WeChat save-draft button was not found.');

    for (let attempt = 0; attempt < 8; attempt++) {
        await page.wait(1);
        const state = await readSaveState(page);
        if (state?.visible && (!before?.visible || state.text !== before.text)) return;
    }
    throw new CommandExecutionError('WeChat draft save was not confirmed by a fresh success status.');
}

export const createDraftCommand = cli({
    site: 'weixin',
    name: 'create-draft',
    access: 'write',
    description: '创建微信公众号图文草稿',
    domain: WEIXIN_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'title', required: true, help: '文章标题 (最长64字)' },
        { name: 'content', required: true, positional: true, help: '文章正文' },
        { name: 'author', help: '作者名 (最长8字)' },
        { name: 'cover-image', help: '封面图片路径 (会先上传到正文再设为封面)' },
        { name: 'summary', help: '文章摘要' },
        { name: 'timeout', type: 'int', required: false, default: 180, help: 'Max seconds for the overall command (default: 180)' },
    ],
    columns: ['status', 'detail'],

    func: async (page, kwargs) => {
        try {
            const coverImage = kwargs['cover-image'] ? resolveCoverImage(kwargs['cover-image']) : null;
            await navigateToEditor(page);

            const titleResult = await fillField(page, 'textarea#title', kwargs.title);
            if (!titleResult?.ok) throw new CommandExecutionError('Failed to fill title');
            if (kwargs.author) {
                const authorResult = await fillField(page, 'input#author', kwargs.author);
                if (!authorResult?.ok) throw new CommandExecutionError('Failed to fill author');
            }
            const contentResult = await fillContent(page, kwargs.content);
            if (!contentResult?.ok) throw new CommandExecutionError('Failed to fill content');

            if (coverImage) {
                await uploadContentImage(page, coverImage);
                const coverSet = await selectCoverFromContent(page);
                if (coverSet !== true) {
                    throw new CommandExecutionError('WeChat uploaded the image but did not confirm it as the draft cover.');
                }
            }

            if (kwargs.summary) {
                const summaryResult = await fillField(page, 'textarea#js_description', kwargs.summary);
                if (!summaryResult?.ok) throw new CommandExecutionError('Failed to fill summary');
            }

            await saveDraft(page);
            return [{
                status: 'draft saved',
                detail: `"${kwargs.title}"${kwargs.author ? ` by ${kwargs.author}` : ''}${coverImage ? ' (with cover)' : ''}`,
            }];
        } catch (error) {
            if (error instanceof CliError) throw error;
            const message = error instanceof Error ? error.message : String(error);
            throw new CommandExecutionError(`WeChat create-draft failed: ${message}`);
        }
    },
});
