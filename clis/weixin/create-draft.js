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
        var editor = document.querySelector('#ueditor_0 .ProseMirror');
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

    const editorReady = await page.evaluate(`(() => {
        var editor = document.querySelector('#ueditor_0 .ProseMirror');
        if (!editor) {
            var editors = document.querySelectorAll('div[contenteditable="true"]');
            editor = editors[editors.length - 1];
        }
        if (!editor) return false;
        editor.focus();
        var range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
        var selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        return true;
    })()`);
    if (!editorReady) {
        throw new CommandExecutionError('Content editor not found before image upload');
    }

    await page.evaluate(`(() => {
        var li = document.querySelector('#js_editor_insertimage');
        if (li) li.click();
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
    await page.evaluate(`(() => {
        var editor = document.querySelector('#ueditor_0 .ProseMirror');
        if (!editor) return { ok: false };
        var images = Array.from(editor.querySelectorAll('img[src*="mmbiz"], img[src*="qpic.cn"]'));
        images.forEach(function(img) {
            var src = img.getAttribute('src') || '';
            if (src && !img.getAttribute('data-src')) img.setAttribute('data-src', src);
            if (!img.getAttribute('data-w') && img.naturalWidth) img.setAttribute('data-w', String(img.naturalWidth));
            if (!img.getAttribute('data-ratio') && img.naturalWidth && img.naturalHeight) {
                img.setAttribute('data-ratio', String(img.naturalHeight / img.naturalWidth));
            }
        });
        return { ok: images.length > 0, count: images.length };
    })()`);
    await page.wait(2);
    return uploadState;
}

async function waitForContentImageUpload(page) {
    for (let attempt = 0; attempt < 30; attempt++) {
        await page.wait(2);
        const state = await page.evaluate(`(() => {
            var editor = document.querySelector('#ueditor_0 .ProseMirror');
            var imageSelector = 'img[src*="mmbiz"], img[src*="qpic.cn"], img[data-src*="mmbiz"], img[data-src*="qpic.cn"]';
            var images = editor
                ? Array.from(editor.querySelectorAll(imageSelector)).map(function(img) {
                    return {
                        src: img.getAttribute('src') || '',
                        dataSrc: img.getAttribute('data-src') || '',
                        width: img.naturalWidth || img.width || 0,
                        height: img.naturalHeight || img.height || 0,
                        parentClass: img.parentElement ? img.parentElement.className || '' : '',
                    };
                })
                : [];
            var cdnCount = images.length;
            if (cdnCount > 0) return { ok: true, cdnCount: cdnCount, images: images };

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

async function hasSelectedCover(page) {
    return page.evaluate(`(() => {
        var area = document.querySelector('#js_cover_area');
        if (!area) return false;
        var preview = area.querySelector('.js_cover_preview_new');
        if (preview) {
            var style = window.getComputedStyle(preview);
            var bg = style.backgroundImage || '';
            if (style.display !== 'none' && bg !== 'none' && !/url\\(["']?["']?\\)/.test(bg)) return true;
        }
        var selectedLabel = area.querySelector('.js_share_type_image');
        return !!(selectedLabel && window.getComputedStyle(selectedLabel).display !== 'none');
    })()`);
}

async function setCoverFromImageUpload(page, imagePath) {
    const contentImageState = await page.evaluate(`(() => {
        var editor = document.querySelector('#ueditor_0 .ProseMirror');
        var imageSelector = 'img[src*="mmbiz"], img[src*="qpic.cn"], img[data-src*="mmbiz"], img[data-src*="qpic.cn"]';
        return { count: editor ? editor.querySelectorAll(imageSelector).length : 0 };
    })()`);
    if (!contentImageState || contentImageState.count < 1) {
        return false;
    }

    const fs = await import('node:fs');
    const path = await import('node:path');
    const absPath = path.default.resolve(imagePath);
    const file = {
        name: path.default.basename(absPath),
        mime: imageMimeType(path.default, absPath),
        base64: fs.default.readFileSync(absPath).toString('base64'),
    };
    const dropped = await page.evaluate(`(() => {
        var target = document.querySelector('#js_cover_area .cover_drop_inner_wrp, #js_cover_area');
        if (!target) return false;
        var file = ${JSON.stringify(file)};
        var binary = atob(file.base64);
        var bytes = new Uint8Array(binary.length);
        for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        var dt = new DataTransfer();
        dt.items.add(new File([new Blob([bytes], { type: file.mime })], file.name, { type: file.mime }));
        ['dragenter', 'dragover', 'drop'].forEach(function(type) {
            target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
        });
        return true;
    })()`);
    if (dropped) {
        for (let attempt = 0; attempt < 15; attempt++) {
            await page.wait(1);
            if (await hasSelectedCover(page)) return true;
            const finishLabel = await page.evaluate(`(() => {
                function visible(el) {
                    return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
                }
                var buttons = Array.from(document.querySelectorAll('button, a, div[role="button"], span'));
                var button = buttons.reverse().find(function(el) {
                    var text = (el.innerText || el.textContent || '').trim();
                    return visible(el) && !el.disabled && (text === '完成' || text === '确认');
                });
                return button ? (button.innerText || button.textContent || '').trim() : '';
            })()`);
            if (finishLabel) {
                await clickVisibleDialogButton(page, '编辑封面', finishLabel);
                await page.wait(3);
                const cropDialogClosed = await page.evaluate(`(() => {
                    function visible(el) {
                        return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
                    }
                    return !Array.from(document.querySelectorAll('.weui-desktop-dialog__wrp, .weui-desktop-dialog, [role="dialog"]'))
                        .some(function(el) { return visible(el) && (el.innerText || '').includes('编辑封面'); });
                })()`);
                if (cropDialogClosed || await hasSelectedCover(page)) return true;
            }
        }
    }
    return false;
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
        button = button.closest('button, a, div[role="button"]') || button;
        button.setAttribute('data-opencli-target', marker);
        button.scrollIntoView({ block: 'center', inline: 'center' });
        return { ok: true, marker: marker };
    })()`);
    assertSettingResult(marked, `${dialogText} dialog`);
    try {
        await page.wait(1);
        const point = await page.evaluate(`(() => {
            var el = document.querySelector('[data-opencli-target="${marker}"]');
            if (!el) return null;
            var rect = el.getBoundingClientRect();
            return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        })()`);
        if (typeof page.nativeClick === 'function' && point && Number.isFinite(point.x) && Number.isFinite(point.y)) {
            await page.nativeClick(Math.round(point.x), Math.round(point.y));
        } else {
            await page.click(`[data-opencli-target="${marker}"]`);
        }
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

async function installCoverRequestFallback(page) {
    const result = await page.evaluate(`(() => {
        var image = document.querySelector('#ueditor_0 .ProseMirror img[data-imgfileid][src*="qpic.cn"]');
        if (!image) return { ok: false, reason: 'uploaded article image not found' };
        var fileId = image.getAttribute('data-imgfileid') || '';
        var cdnUrl = image.getAttribute('data-src') || image.getAttribute('src') || '';
        if (!fileId || !cdnUrl) return { ok: false, reason: 'uploaded article image metadata is incomplete' };

        if (!window.__opencliWeixinCoverPatch) {
            var originalOpen = XMLHttpRequest.prototype.open;
            var originalSend = XMLHttpRequest.prototype.send;
            XMLHttpRequest.prototype.open = function(method, url) {
                this.__opencliRequestUrl = String(url || '');
                return originalOpen.apply(this, arguments);
            };
            XMLHttpRequest.prototype.send = function(body) {
                var patch = window.__opencliWeixinCoverPatch;
                if (patch && this.__opencliRequestUrl.includes('operate_appmsg') && this.__opencliRequestUrl.includes('sub=create') && typeof body === 'string') {
                    var params = new URLSearchParams(body);
                    params.set('fileid0', patch.fileId);
                    params.set('cdn_url0', patch.cdnUrl);
                    params.set('cdn_url_back0', patch.cdnUrl);
                    params.set('cdn_235_1_url0', patch.cdnUrl);
                    params.set('cdn_16_9_url0', patch.cdnUrl);
                    params.set('cdn_3_4_url0', patch.cdnUrl);
                    params.set('cdn_1_1_url0', patch.cdnUrl);
                    params.set('last_choose_cover_from0', '1');
                    patch.applied = true;
                    body = params.toString();
                }
                return originalSend.call(this, body);
            };
        }
        window.__opencliWeixinCoverPatch = { fileId: fileId, cdnUrl: cdnUrl, applied: false };
        return { ok: true, fileId: fileId, cdnUrl: cdnUrl };
    })()`);
    if (!result?.ok) {
        throw new CommandExecutionError(`Could not prepare the cover upload fallback: ${result?.reason || 'unknown error'}`);
    }
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

        let usedCoverRequestFallback = false;
        if (kwargs['cover-image']) {
            await uploadContentImage(page, kwargs['cover-image']);
            const coverSet = await setCoverFromImageUpload(page, kwargs['cover-image']);
            if (!coverSet) {
                await installCoverRequestFallback(page);
                usedCoverRequestFallback = true;
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
        if (usedCoverRequestFallback) {
            const patchApplied = await page.evaluate('!!window.__opencliWeixinCoverPatch?.applied');
            if (!patchApplied) {
                throw new CommandExecutionError('The draft save request did not include the uploaded cover image');
            }
        }

        return [{
            status: success ? 'draft saved' : 'save attempted, check browser to confirm',
            detail: `"${kwargs.title}"${kwargs.author ? ` by ${kwargs.author}` : ''}${kwargs['cover-image'] ? ' (with cover)' : ''}${appliedSettings.length ? ` (${appliedSettings.join(', ')})` : ''}`,
        }];
    },
});
