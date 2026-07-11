import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';

const WEIXIN_DOMAIN = 'mp.weixin.qq.com';
const WEIXIN_HOME = 'https://mp.weixin.qq.com/';
const IMAGE_FILE_INPUT_SELECTOR = 'input[type="file"][name="file"]';
const SUPPORTED_WEIXIN_COLLECTIONS = ['物理', '数学', '生物', '地理', '英语', '化学'];

function isRecoverableFileInputError(error) {
    const msg = error instanceof Error ? error.message : String(error);
    return /unknown action|not supported|not[-\s]?allowed|notallowederror/i.test(msg);
}

function imageMimeType(pathModule, absPath) {
    const ext = pathModule.extname(absPath).toLowerCase();
    if (ext === '.png') return 'image/png';
    if (ext === '.gif') return 'image/gif';
    if (ext === '.webp') return 'image/webp';
    return 'image/jpeg';
}

async function getToken(page) {
    return page.evaluate(`(window.location.href.match(/token=(\\d+)/)||[])[1]`);
}

async function navigateToEditor(page) {
    await page.goto(WEIXIN_HOME);
    await page.wait(3);
    const token = await getToken(page);
    if (!token) {
        throw new CommandExecutionError('Could not extract session token. Please log in to mp.weixin.qq.com');
    }
    await page.goto(`https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=77&token=${token}&lang=zh_CN`);
    await page.wait(4);
    const hasTitle = await page.evaluate('!!document.querySelector("textarea#title")');
    if (!hasTitle) {
        throw new CommandExecutionError('Article editor did not load. Session may have expired');
    }
}

async function fillField(page, selector, value) {
    return page.evaluate(`(() => {
        var el = document.querySelector('${selector}');
        if (!el) return { ok: false, reason: 'not found: ${selector}' };
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
    return page.evaluate(`(() => {
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

async function uploadContentImage(page, imagePath) {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const absPath = path.default.resolve(imagePath);
    if (!fs.default.existsSync(absPath)) {
        throw new CommandExecutionError(`Image not found: ${absPath}`);
    }

    await page.evaluate(`(() => {
        var li = document.querySelector('#js_editor_insertimage');
        if (li) li.click();
    })()`);
    await page.wait(1);
    await page.evaluate(`(() => {
        var items = document.querySelectorAll('.js_img_dropdown_menu .tpl_dropdown_menu_item');
        if (items[0]) items[0].click();
    })()`);
    await page.wait(1);

    let uploaded = false;
    if (page.setFileInput) {
        try {
            await page.setFileInput([absPath], IMAGE_FILE_INPUT_SELECTOR);
            uploaded = true;
        } catch (error) {
            if (!isRecoverableFileInputError(error)) throw error;
        }
    }
    if (!uploaded) {
        const base64 = fs.default.readFileSync(absPath).toString('base64');
        if (base64.length > 500_000) {
            console.warn(`[warn] Image base64 payload is ${(base64.length / 1024 / 1024).toFixed(1)}MB. ` +
                'This may fail with the browser bridge. Update Browser Bridge for CDP-based upload, or compress the image.');
        }
        const mimeType = imageMimeType(path.default, absPath);
        const fallbackResult = await page.evaluate(`(() => {
            var input = document.querySelector(${JSON.stringify(IMAGE_FILE_INPUT_SELECTOR)});
            if (!input) {
                var inputs = Array.from(document.querySelectorAll('input[type="file"]'));
                input = inputs.find(function(el) {
                    var accept = el.getAttribute('accept') || '';
                    return accept.includes('image') || accept.includes('.jpg') || accept.includes('.jpeg') || accept.includes('.png') || accept.includes('.gif') || accept.includes('.webp');
                });
            }
            if (!input) return { ok: false, error: 'image file input not found' };

            var binary = atob(${JSON.stringify(base64)});
            var bytes = new Uint8Array(binary.length);
            for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

            var dt = new DataTransfer();
            var blob = new Blob([bytes], { type: ${JSON.stringify(mimeType)} });
            dt.items.add(new File([blob], ${JSON.stringify(path.default.basename(absPath))}, { type: ${JSON.stringify(mimeType)} }));

            var assigned = false;
            try {
                Object.defineProperty(input, 'files', { value: dt.files, writable: false, configurable: true });
                assigned = input.files && input.files.length > 0;
            } catch (e) {
                try {
                    var descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'files');
                    if (descriptor && descriptor.set) {
                        descriptor.set.call(input, dt.files);
                        assigned = input.files && input.files.length > 0;
                    }
                } catch (e2) {
                    assigned = false;
                }
            }
            if (!assigned) return { ok: false, error: 'could not assign files to input' };

            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            return { ok: true, count: input.files.length };
        })()`);
        if (!fallbackResult?.ok) {
            throw new CommandExecutionError(`Image upload fallback failed: ${fallbackResult?.error || 'unknown error'}`);
        }
    }
    const uploadState = await waitForContentImageUpload(page);
    if (!uploadState?.ok) {
        throw new CommandExecutionError('Image did not upload to WeChat CDN');
    }
}

async function waitForContentImageUpload(page) {
    for (let attempt = 0; attempt < 30; attempt++) {
        await page.wait(2);
        const state = await page.evaluate(`(() => {
            var editor = document.querySelector('#ueditor_0');
            var cdnCount = editor
                ? editor.querySelectorAll('img[src*="mmbiz"], img[src*="qpic.cn"], img[data-src*="mmbiz"], img[data-src*="qpic.cn"]').length
                : 0;
            if (cdnCount > 0) return { ok: true, cdnCount: cdnCount };

            var uploading = Array.from(document.querySelectorAll('.upload_file, .progress_bar, .progress_bar_thumb')).some(function(el) {
                return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
            });
            var errorText = Array.from(document.querySelectorAll('.weui-desktop-tips, .weui-desktop-toast, .js_msgSenderTips')).map(function(el) {
                return (el.innerText || el.textContent || '').trim();
            }).filter(Boolean).join('\\n');
            return { ok: false, cdnCount: 0, uploading: uploading, errorText: errorText };
        })()`);
        if (state?.ok) return state;
        if (state?.errorText && /(无法解析|上传失败|过大|频繁|不支持|错误)/.test(state.errorText)) return state;
    }
    return { ok: false, timeout: true };
}

async function selectCoverFromContent(page) {
    await page.evaluate('document.querySelector("#js_cover_description_area")?.scrollIntoView()');
    await page.wait(1);

    await page.evaluate('document.querySelector(".js_cover_btn_area")?.click()');
    await page.wait(1);

    await page.evaluate(`(() => {
        var links = document.querySelectorAll('a.pop-opr__button');
        for (var i = 0; i < links.length; i++) {
            if (links[i].textContent.trim() === '从正文选择') { links[i].click(); return; }
        }
    })()`);
    await page.wait(2);

    await page.evaluate(`(() => {
        var img = document.querySelector('.weui-desktop-dialog_img-picker .appmsg_content_img');
        if (img) img.click();
    })()`);
    await page.wait(1);

    await page.evaluate(`(() => {
        var btns = document.querySelectorAll('.weui-desktop-dialog_img-picker button');
        for (var i = 0; i < btns.length; i++) {
            if (btns[i].textContent.trim() === '下一步' && !btns[i].disabled) { btns[i].click(); return; }
        }
    })()`);

    // Crop dialog image rendering can be slow
    for (let attempt = 0; attempt < 8; attempt++) {
        await page.wait(2);
        const ready = await page.evaluate(`(() => {
            var btns = document.querySelectorAll('button');
            for (var i = 0; i < btns.length; i++) {
                if (btns[i].textContent.trim() === '确认' && btns[i].offsetHeight > 0 && !btns[i].disabled) return true;
            }
            return false;
        })()`);
        if (ready) break;
    }

    await page.evaluate(`(() => {
        var btns = document.querySelectorAll('button');
        for (var i = 0; i < btns.length; i++) {
            if (btns[i].textContent.trim() === '确认' && btns[i].offsetHeight > 0 && !btns[i].disabled) { btns[i].click(); return; }
        }
    })()`);
    await page.wait(2);
    const hasCover = await page.evaluate(`(() => {
        var area = document.querySelector('#js_cover_area');
        if (!area) return false;
        var found = false;
        area.querySelectorAll('*').forEach(function(el) {
            var bg = window.getComputedStyle(el).backgroundImage;
            if (bg && bg.includes('mmbiz')) found = true;
        });
        return found;
    })()`);
    return hasCover;
}

async function scrollToPublishSettings(page) {
    await page.evaluate(`(() => {
        var selectors = ['#js_setting_area', '#js_cover_description_area', '#js_article_extend', '#js_related_article_area'];
        for (var i = 0; i < selectors.length; i++) {
            var el = document.querySelector(selectors[i]);
            if (el) {
                el.scrollIntoView({ block: 'center' });
                return { ok: true, selector: selectors[i] };
            }
        }
        window.scrollTo(0, document.body.scrollHeight);
        return { ok: true, selector: 'document-bottom' };
    })()`);
    await page.wait(1);
}

async function confirmVisibleDialog(page, labels = ['确定', '确认', '完成']) {
    for (let attempt = 0; attempt < 3; attempt++) {
        const result = await page.evaluate(`(() => {
            var labels = ${JSON.stringify(labels)};
            function visible(el) {
                return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
            }
            function text(el) {
                return (el && (el.innerText || el.textContent) || '').replace(/\\s+/g, '').trim();
            }
            var buttons = Array.from(document.querySelectorAll('button, a, span, div[role="button"]'))
                .filter(function(el) { return visible(el) && !el.disabled; });
            for (var i = 0; i < labels.length; i++) {
                var label = labels[i];
                var button = buttons.find(function(el) { return text(el) === label || text(el).includes(label); });
                if (button) {
                    button.click();
                    return { ok: true, label: label };
                }
            }
            return { ok: false };
        })()`);
        if (!result?.ok) return result;
        await page.wait(1);
    }
    return { ok: true };
}

function assertSettingResult(result, label) {
    if (!result?.ok) {
        throw new CommandExecutionError(`${label} failed: ${result?.reason || result?.error || 'setting control not found'}`);
    }
}

async function enableOriginalDeclaration(page, declarationName) {
    await scrollToPublishSettings(page);
    const openResult = await page.evaluate(`(() => {
        function visible(el) {
            return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
        }
        function text(el) {
            return (el && (el.innerText || el.textContent) || '').replace(/\\s+/g, '').trim();
        }
        function clickable(el) {
            var cur = el;
            while (cur && cur !== document.body) {
                var tag = cur.tagName || '';
                var role = cur.getAttribute && cur.getAttribute('role');
                var cls = cur.className || '';
                if (tag === 'BUTTON' || tag === 'A' || role === 'button' || role === 'switch' || /btn|button|switch|checkbox|radio|link/.test(String(cls))) return cur;
                cur = cur.parentElement;
            }
            return el;
        }
        function findAction(patterns) {
            var nodes = Array.from(document.querySelectorAll('button, a, span, div, label'));
            for (var p = 0; p < patterns.length; p++) {
                var pattern = patterns[p];
                for (var i = 0; i < nodes.length; i++) {
                    var nodeText = text(nodes[i]);
                    if (visible(nodes[i]) && pattern.test(nodeText)) return clickable(nodes[i]);
                }
            }
            return null;
        }
        var bodyText = text(document.body);
        if (/已声明原创|原创声明已开启|已开启原创/.test(bodyText)) return { ok: true, already: true };
        var action = findAction([/声明原创/, /原创声明/, /^原创$/]);
        if (!action) return { ok: false, reason: 'original declaration action not found' };
        action.click();
        return { ok: true, opened: true, actionText: text(action).slice(0, 80) };
    })()`);
    assertSettingResult(openResult, 'Original declaration');
    if (openResult.already) return openResult;

    await page.wait(2);
    const dialogResult = await page.evaluate(`(() => {
        var declarationName = ${JSON.stringify(declarationName || '')};
        function visible(el) {
            return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
        }
        function text(el) {
            return (el && (el.innerText || el.textContent) || '').replace(/\\s+/g, '').trim();
        }
        function setValue(el, value) {
            el.focus();
            var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
            var setter = Object.getOwnPropertyDescriptor(proto, 'value');
            if (setter && setter.set) setter.set.call(el, value);
            else el.value = value;
            el.dispatchEvent(new InputEvent('input', { bubbles: true, data: value }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
        }
        function clickClosest(el) {
            var cur = el;
            while (cur && cur !== document.body) {
                var tag = cur.tagName || '';
                var role = cur.getAttribute && cur.getAttribute('role');
                if (tag === 'BUTTON' || tag === 'A' || tag === 'LABEL' || role === 'button' || role === 'checkbox') {
                    cur.click();
                    return true;
                }
                cur = cur.parentElement;
            }
            if (el) { el.click(); return true; }
            return false;
        }
        var dialog = Array.from(document.querySelectorAll('.weui-desktop-dialog, .weui-desktop-popover, .popover, .dialog, [role="dialog"]'))
            .filter(visible).pop() || document;
        if (declarationName) {
            var fields = Array.from(dialog.querySelectorAll('input, textarea'))
                .filter(function(el) { return visible(el) && !el.disabled && !el.readOnly && el.type !== 'file' && el.type !== 'checkbox' && el.type !== 'radio'; });
            var field = fields.find(function(el) {
                var meta = [el.placeholder, el.name, el.id, el.getAttribute('aria-label'), el.getAttribute('title')].join(' ');
                return /作者|署名|名称|原创/.test(meta);
            }) || fields[0];
            if (field) setValue(field, declarationName);
        }
        Array.from(dialog.querySelectorAll('input[type="checkbox"]')).forEach(function(el) {
            if (visible(el) && !el.checked) el.click();
        });
        Array.from(dialog.querySelectorAll('label, span, a, div')).forEach(function(el) {
            var nodeText = text(el);
            if (visible(el) && /我已阅读|同意|原创声明/.test(nodeText) && !/不同意/.test(nodeText)) clickClosest(el);
        });
        var buttons = Array.from(dialog.querySelectorAll('button, a, span, div[role="button"]'))
            .filter(function(el) { return visible(el) && !el.disabled; });
        var labels = ['同意并声明', '提交声明', '声明原创', '确定', '确认', '下一步', '完成'];
        for (var i = 0; i < labels.length; i++) {
            var label = labels[i];
            var button = buttons.find(function(el) { return text(el) === label || text(el).includes(label); });
            if (button) {
                button.click();
                return { ok: true, submitted: true, label: label };
            }
        }
        return { ok: true, opened: true, reason: 'no confirmation button found after opening original dialog' };
    })()`);
    assertSettingResult(dialogResult, 'Original declaration');
    await page.wait(2);
    await confirmVisibleDialog(page, ['确定', '确认', '完成', '我知道了']);
    return dialogResult;
}

async function enableReward(page) {
    await scrollToPublishSettings(page);
    const result = await page.evaluate(`(() => {
        function visible(el) {
            return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
        }
        function text(el) {
            return (el && (el.innerText || el.textContent) || '').replace(/\\s+/g, '').trim();
        }
        function closestRow(el) {
            var cur = el;
            while (cur && cur !== document.body) {
                var rowText = text(cur);
                if (rowText.includes('赞赏') && rowText.length < 260) return cur;
                cur = cur.parentElement;
            }
            return el;
        }
        var label = Array.from(document.querySelectorAll('span, div, label, a'))
            .find(function(el) { return visible(el) && text(el).includes('赞赏'); });
        if (!label) return { ok: false, reason: 'reward setting not found' };
        var row = closestRow(label);
        var rowText = text(row);
        if (/已开启赞赏|赞赏已开启|已开启/.test(rowText) || row.querySelector('input[type="checkbox"]:checked')) {
            return { ok: true, already: true };
        }
        var control = row.querySelector('input[type="checkbox"], [role="switch"], .weui-desktop-switch, .weui-desktop-switch__box, .weui-desktop-form__switch, button, a');
        if (!control) control = row;
        control.click();
        return { ok: true, clicked: true, rowText: rowText.slice(0, 120) };
    })()`);
    assertSettingResult(result, 'Reward');
    if (!result.already) {
        await page.wait(1);
        await confirmVisibleDialog(page, ['开启', '确定', '确认', '完成', '我知道了']);
    }
    return result;
}

async function selectCollection(page, collection) {
    if (!SUPPORTED_WEIXIN_COLLECTIONS.includes(collection)) {
        throw new CommandExecutionError(`Unsupported Weixin collection: ${collection}. Supported: ${SUPPORTED_WEIXIN_COLLECTIONS.join(', ')}`);
    }
    await scrollToPublishSettings(page);
    const openResult = await page.evaluate(`(() => {
        var target = ${JSON.stringify(collection)};
        function visible(el) {
            return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
        }
        function text(el) {
            return (el && (el.innerText || el.textContent) || '').replace(/\\s+/g, '').trim();
        }
        function closestRow(el) {
            var cur = el;
            while (cur && cur !== document.body) {
                var rowText = text(cur);
                if (rowText.includes('合集') && rowText.length < 360) return cur;
                cur = cur.parentElement;
            }
            return el;
        }
        var label = Array.from(document.querySelectorAll('span, div, label, a'))
            .find(function(el) { return visible(el) && text(el).includes('合集'); });
        if (!label) return { ok: false, reason: 'collection setting not found' };
        var row = closestRow(label);
        var rowText = text(row);
        if (rowText.includes(target)) return { ok: true, already: true };
        var buttons = Array.from(row.querySelectorAll('button, a, span, div[role="button"]')).filter(visible);
        var action = buttons.find(function(el) {
            var t = text(el);
            return /选择合集|添加到合集|添加合集|修改|更换|设置/.test(t);
        }) || row.querySelector('[role="combobox"], .weui-desktop-dropdown__switch, .weui-desktop-form__input, button, a') || row;
        action.click();
        return { ok: true, opened: true, rowText: rowText.slice(0, 120) };
    })()`);
    assertSettingResult(openResult, 'Collection');
    if (openResult.already) return openResult;

    await page.wait(1);
    const chooseResult = await page.evaluate(`(() => {
        var target = ${JSON.stringify(collection)};
        function visible(el) {
            return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
        }
        function text(el) {
            return (el && (el.innerText || el.textContent) || '').replace(/\\s+/g, '').trim();
        }
        function clickable(el) {
            var cur = el;
            while (cur && cur !== document.body) {
                var tag = cur.tagName || '';
                var role = cur.getAttribute && cur.getAttribute('role');
                var cls = cur.className || '';
                if (tag === 'BUTTON' || tag === 'A' || tag === 'LI' || role === 'button' || role === 'option' || /item|option|menu|dropdown|radio|checkbox/.test(String(cls))) return cur;
                cur = cur.parentElement;
            }
            return el;
        }
        var nodes = Array.from(document.querySelectorAll('li, option, button, a, span, div, label'))
            .filter(function(el) { return visible(el); });
        var exact = nodes.find(function(el) { return text(el) === target; });
        var partial = nodes.find(function(el) { var t = text(el); return t.includes(target) && t.length <= 40; });
        var hit = exact || partial;
        if (!hit) {
            var options = nodes.map(text).filter(function(t) { return t && t.length <= 40; }).slice(0, 30);
            return { ok: false, reason: 'collection option not found: ' + target, options: options };
        }
        clickable(hit).click();
        return { ok: true, collection: target };
    })()`);
    assertSettingResult(chooseResult, 'Collection');
    await page.wait(1);
    await confirmVisibleDialog(page, ['确定', '确认', '完成']);
    return chooseResult;
}

async function clickSaveDraft(page) {
    const result = await page.evaluate(`(() => {
        var btns = document.querySelectorAll('span, button, a');
        for (var i = 0; i < btns.length; i++) {
            if ((btns[i].textContent || '').trim() === '保存为草稿') { btns[i].click(); return { ok: true }; }
        }
        return { ok: false };
    })()`);
    if (!result?.ok) throw new CommandExecutionError('Save draft button not found');

    for (let attempt = 0; attempt < 5; attempt++) {
        await page.wait(2);
        const saved = await page.evaluate(`(() => {
            var el = document.querySelector('#js_save_success');
            if (el && window.getComputedStyle(el).display !== 'none') return true;
            return document.body.innerText.includes('已保存');
        })()`);
        if (saved) return true;
    }
    return false;
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
        { name: 'original-declaration', help: '开启原创声明并填写原创署名，例如：一页科学课' },
        { name: 'reward', type: 'bool', default: false, help: '开启公众号赞赏' },
        { name: 'collection', choices: SUPPORTED_WEIXIN_COLLECTIONS, help: `选择合集：${SUPPORTED_WEIXIN_COLLECTIONS.join(', ')}` },
        { name: 'timeout', type: 'int', required: false, default: 180, help: 'Max seconds for the overall command (default: 180)' },
    ],
    columns: ['status', 'detail'],

    func: async (page, kwargs) => {
        await navigateToEditor(page);

        const titleResult = await fillField(page, 'textarea#title', kwargs.title);
        if (!titleResult?.ok) throw new CommandExecutionError('Failed to fill title');

        if (kwargs.author) {
            const authorResult = await fillField(page, 'input#author', kwargs.author);
            if (!authorResult?.ok) throw new CommandExecutionError('Failed to fill author');
        }

        const contentResult = await fillContent(page, kwargs.content);
        if (!contentResult?.ok) throw new CommandExecutionError('Failed to fill content');

        if (kwargs['cover-image']) {
            await uploadContentImage(page, kwargs['cover-image']);
            const coverSet = await selectCoverFromContent(page);
            if (!coverSet) {
                // Non-fatal: draft can be saved without cover
            }
        }

        if (kwargs.summary) {
            await fillField(page, 'textarea#js_description', kwargs.summary);
        }

        const appliedSettings = [];
        if (kwargs['original-declaration']) {
            await enableOriginalDeclaration(page, kwargs['original-declaration']);
            appliedSettings.push('original');
        }
        if (kwargs.reward) {
            await enableReward(page);
            appliedSettings.push('reward');
        }
        if (kwargs.collection) {
            await selectCollection(page, kwargs.collection);
            appliedSettings.push(`collection:${kwargs.collection}`);
        }

        await page.wait(1);
        const success = await clickSaveDraft(page);

        return [{
            status: success ? 'draft saved' : 'save attempted, check browser to confirm',
            detail: `"${kwargs.title}"${kwargs.author ? ` by ${kwargs.author}` : ''}${kwargs['cover-image'] ? ' (with cover)' : ''}${appliedSettings.length ? ` (${appliedSettings.join(', ')})` : ''}`,
        }];
    },
});
