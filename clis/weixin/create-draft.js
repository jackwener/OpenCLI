import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';

const WEIXIN_DOMAIN = 'mp.weixin.qq.com';
const WEIXIN_HOME = 'https://mp.weixin.qq.com/';
const IMAGE_FILE_INPUT_SELECTOR = 'input[type="file"][name="file"]';

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
            var editors = Array.from(document.querySelectorAll('div[contenteditable="true"]'));
            var editor = editors[editors.length - 1];
            var imageSelector = 'img[src*="mmbiz"], img[src*="qpic.cn"], img[data-src*="mmbiz"], img[data-src*="qpic.cn"]';
            var cdnCount = editor
                ? editor.querySelectorAll(imageSelector).length
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
    const contentImageState = await page.evaluate(`(() => {
        var editors = Array.from(document.querySelectorAll('div[contenteditable="true"]'));
        var editor = editors[editors.length - 1];
        var imageSelector = 'img[src*="mmbiz"], img[src*="qpic.cn"], img[data-src*="mmbiz"], img[data-src*="qpic.cn"]';
        return { count: editor ? editor.querySelectorAll(imageSelector).length : 0 };
    })()`);
    if (!contentImageState || contentImageState.count < 1) {
        return false;
    }

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

    const picked = await page.evaluate(`(() => {
        var img = document.querySelector('.weui-desktop-dialog_img-picker .appmsg_content_img');
        if (img) { img.click(); return true; }
        return false;
    })()`);
    if (!picked) {
        await page.evaluate(`(() => {
            var close = document.querySelector('.weui-desktop-dialog_img-picker .weui-desktop-dialog__close-btn, .weui-desktop-dialog_img-picker button[aria-label="关闭"], .weui-desktop-dialog__wrp .weui-desktop-dialog__close-btn');
            if (close) close.click();
        })()`);
        return false;
    }
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

function assertSettingResult(result, label) {
    if (!result?.ok) {
        throw new CommandExecutionError(`${label} failed: ${result?.reason || result?.error || 'setting control not found'}`);
    }
}

async function waitForSetting(page, label, js, attempts = 10) {
    let state = null;
    for (let attempt = 0; attempt < attempts; attempt++) {
        state = await page.evaluate(js);
        if (state?.ok) return state;
        await page.wait(1);
    }
    throw new CommandExecutionError(`${label} failed: ${state?.reason || state?.text || 'state did not update'}`);
}

async function clickVisibleDialogButton(page, dialogText, buttonText) {
    const marker = `opencli-target-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const marked = await page.evaluate(`(() => {
        var dialogText = ${JSON.stringify(dialogText)};
        var buttonText = ${JSON.stringify(buttonText)};
        var marker = ${JSON.stringify(marker)};
        function visible(el) {
            return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
        }
        function text(el) {
            return (el && (el.innerText || el.textContent) || '').replace(/\\s+/g, '').trim();
        }
        var dialog = Array.from(document.querySelectorAll('.weui-desktop-dialog__wrp, .weui-desktop-dialog, [role="dialog"]'))
            .filter(function(el) { return visible(el) && text(el).includes(dialogText); })[0];
        if (!dialog) return { ok: false, reason: 'visible dialog not found: ' + dialogText };
        var button = Array.from(dialog.querySelectorAll('button, a, div[role="button"], span'))
            .filter(function(el) { return visible(el) && !el.disabled; })
            .find(function(el) { return text(el) === buttonText; });
        if (!button) return { ok: false, reason: 'button not found: ' + buttonText, dialog: text(dialog).slice(0, 300) };
        button.setAttribute('data-opencli-target', marker);
        return { ok: true, marker: marker };
    })()`);
    assertSettingResult(marked, `${dialogText} dialog`);
    try {
        await page.click(`[data-opencli-target="${marker}"]`);
    } finally {
        await page.evaluate(`(() => {
            var el = document.querySelector('[data-opencli-target="${marker}"]');
            if (el) el.removeAttribute('data-opencli-target');
        })()`).catch(() => undefined);
    }
}

async function clickVisibleDialogText(page, dialogText, targetText) {
    const marker = `opencli-target-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const marked = await page.evaluate(`(() => {
        var dialogText = ${JSON.stringify(dialogText)};
        var targetText = ${JSON.stringify(targetText)};
        var marker = ${JSON.stringify(marker)};
        function visible(el) {
            return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
        }
        function text(el) {
            return (el && (el.innerText || el.textContent) || '').replace(/\\s+/g, '').trim();
        }
        var dialog = Array.from(document.querySelectorAll('.weui-desktop-dialog__wrp, .weui-desktop-dialog, [role="dialog"]'))
            .filter(function(el) { return visible(el) && text(el).includes(dialogText); })[0];
        if (!dialog) return { ok: false, reason: 'visible dialog not found: ' + dialogText };
        var target = Array.from(dialog.querySelectorAll('label, button, a, span, div[role="button"], div'))
            .filter(function(el) { return visible(el); })
            .find(function(el) { return text(el).includes(targetText); });
        if (!target) return { ok: false, reason: 'target text not found: ' + targetText, dialog: text(dialog).slice(0, 300) };
        target.setAttribute('data-opencli-target', marker);
        return { ok: true, marker: marker };
    })()`);
    assertSettingResult(marked, `${dialogText} dialog`);
    try {
        await page.click(`[data-opencli-target="${marker}"]`);
    } finally {
        await page.evaluate(`(() => {
            var el = document.querySelector('[data-opencli-target="${marker}"]');
            if (el) el.removeAttribute('data-opencli-target');
        })()`).catch(() => undefined);
    }
}

async function getOriginalDeclarationState(page) {
    return page.evaluate(`(() => {
        function visible(el) {
            return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
        }
        function text(el) {
            return (el && (el.innerText || el.textContent) || '').replace(/\\s+/g, '').trim();
        }
        var boxText = text(document.querySelector('#js_original_box'));
        var dialogText = Array.from(document.querySelectorAll('.claim__original-dialog.original_dialog, .weui-desktop-dialog__wrp'))
            .filter(visible).map(function(el) { return text(el); }).join(' | ');
        return {
            ok: /文字原创|已声明|作者:/.test(boxText) && !/未声明/.test(boxText),
            text: boxText,
            dialogText: dialogText.slice(0, 500),
        };
    })()`);
}

async function enableOriginalDeclaration(page, declarationName) {
    await scrollToPublishSettings(page);
    const before = await getOriginalDeclarationState(page);
    if (before?.ok) return { ok: true, already: true, text: before.text };

    await page.click('.setting-group__switch.js_original_apply.js_edit_ori', { nth: 0 });
    await waitForSetting(page, 'Original declaration dialog', `(() => {
        function visible(el) {
            return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
        }
        var dialog = document.querySelector('.claim__original-dialog.original_dialog');
        return { ok: visible(dialog), text: dialog ? (dialog.innerText || '').slice(0, 300) : '' };
    })()`);

    if (declarationName) {
        await page.click('input.frm_input.js_counter.js_author', { nth: 1 });
        await page.pressKey('Meta+A');
        await page.pressKey('Backspace');
        await page.typeText('input.frm_input.js_counter.js_author', declarationName, { nth: 1 });
        await waitForSetting(page, 'Original declaration author', `(() => {
            var expected = ${JSON.stringify(declarationName)};
            var inputs = Array.from(document.querySelectorAll('input.frm_input.js_counter.js_author'));
            var hasValue = inputs.some(function(input) { return input.value === expected; });
            var text = (document.querySelector('.claim__original-dialog.original_dialog')?.innerText || '').replace(/\\s+/g, ' ').trim();
            return { ok: (hasValue || text.includes(expected)) && !/作者不能为空/.test(text), text: text.slice(0, 300) };
        })()`);
    }

    const agreement = await page.evaluate(`(() => {
        var cb = document.querySelector('.original_agreement input[type="checkbox"]');
        return { ok: true, checked: cb ? cb.checked : true };
    })()`);
    if (agreement && agreement.checked === false) {
        await page.click('.original_agreement label.weui-desktop-form__check-label');
    }

    await clickVisibleDialogButton(page, '原创', '确定');
    return waitForSetting(page, 'Original declaration', `(() => {
        function visible(el) {
            return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
        }
        function text(el) {
            return (el && (el.innerText || el.textContent) || '').replace(/\\s+/g, ' ').trim();
        }
        var boxText = text(document.querySelector('#js_original_box'));
        var dialogText = Array.from(document.querySelectorAll('.claim__original-dialog.original_dialog, .weui-desktop-dialog__wrp'))
            .filter(visible).map(function(el) { return text(el); }).join(' | ');
        return {
            ok: /文字原创|已声明|作者:/.test(boxText) && !/未声明/.test(boxText),
            text: (boxText || dialogText).slice(0, 500),
        };
    })()`, 12);
}

async function getRewardState(page) {
    return page.evaluate(`(() => {
        function text(el) {
            return (el && (el.innerText || el.textContent) || '').replace(/\\s+/g, ' ').trim();
        }
        var area = document.querySelector('#js_reward_setting_area');
        var areaText = text(area);
        var checked = !!document.querySelector('#js_reward_setting_area input.js_reward_setting_checkbox')?.checked;
        return {
            ok: checked || (/账户:/.test(areaText) && !/不开启/.test(areaText)),
            disabled: /声明原创后才可开启/.test(text(document.querySelector('#js_original_box'))),
            text: areaText || text(document.querySelector('#js_original_box')).slice(0, 300),
            checked: checked,
        };
    })()`);
}

async function enableReward(page, rewardAccount) {
    await scrollToPublishSettings(page);
    const before = await getRewardState(page);
    if (before?.ok) return { ok: true, already: true, text: before.text };
    if (before?.disabled) {
        throw new CommandExecutionError('Reward failed: original declaration must be enabled before reward can be enabled');
    }

    await page.click('.setting-group__switch.js_reward_open');
    await waitForSetting(page, 'Reward dialog', `(() => {
        function visible(el) {
            return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
        }
        function text(el) {
            return (el && (el.innerText || el.textContent) || '').replace(/\\s+/g, '').trim();
        }
        var dialog = Array.from(document.querySelectorAll('.weui-desktop-dialog__wrp'))
            .find(function(el) { return visible(el) && text(el).includes('赞赏类型'); });
        return { ok: !!dialog, text: dialog ? text(dialog).slice(0, 300) : '' };
    })()`);

    const rewardDialogState = await page.evaluate(`(() => {
        function visible(el) {
            return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
        }
        var dialog = Array.from(document.querySelectorAll('.weui-desktop-dialog__wrp'))
            .find(function(el) { return visible(el) && (el.innerText || '').includes('赞赏类型'); });
        var authorRadio = dialog?.querySelector('input.weui-desktop-form__radio[value="1"]');
        var agreement = dialog?.querySelector('input.weui-desktop-form__checkbox');
        var accountInput = dialog?.querySelector('input[placeholder="选择或搜索赞赏账户"]');
        return {
            ok: !!dialog,
            authorChecked: authorRadio ? authorRadio.checked : true,
            agreementChecked: agreement ? agreement.checked : true,
            account: accountInput ? accountInput.value : '',
        };
    })()`);
    assertSettingResult(rewardDialogState, 'Reward dialog');
    if (rewardDialogState.authorChecked === false) {
        await page.click('.weui-desktop-dialog__wrp input.weui-desktop-form__radio[value="1"]');
    }
    if (rewardAccount && rewardDialogState.account !== rewardAccount) {
        await page.click('.weui-desktop-dialog__wrp input[placeholder="选择或搜索赞赏账户"]');
        await page.pressKey('Meta+A');
        await page.pressKey('Backspace');
        await page.typeText('.weui-desktop-dialog__wrp input[placeholder="选择或搜索赞赏账户"]', rewardAccount);
        await page.wait(1);
    }
    if (rewardDialogState.agreementChecked === false) {
        await clickVisibleDialogText(page, '赞赏类型', '赞赏功能使用协议');
    }

    await clickVisibleDialogButton(page, '赞赏类型', '确定');
    return waitForSetting(page, 'Reward', `(() => {
        function text(el) {
            return (el && (el.innerText || el.textContent) || '').replace(/\\s+/g, ' ').trim();
        }
        var area = document.querySelector('#js_reward_setting_area');
        var areaText = text(area);
        var checked = !!document.querySelector('#js_reward_setting_area input.js_reward_setting_checkbox')?.checked;
        return {
            ok: checked || (/账户:/.test(areaText) && !/不开启/.test(areaText)),
            text: areaText,
        };
    })()`, 10);
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
        { name: 'reward-account', help: '赞赏账户名称；默认使用原创署名或作者名' },
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
            await enableReward(page, kwargs['reward-account'] || kwargs['original-declaration'] || kwargs.author || '');
            appliedSettings.push('reward');
        }
        await page.wait(1);
        const success = await clickSaveDraft(page);

        return [{
            status: success ? 'draft saved' : 'save attempted, check browser to confirm',
            detail: `"${kwargs.title}"${kwargs.author ? ` by ${kwargs.author}` : ''}${kwargs['cover-image'] ? ' (with cover)' : ''}${appliedSettings.length ? ` (${appliedSettings.join(', ')})` : ''}`,
        }];
    },
});
