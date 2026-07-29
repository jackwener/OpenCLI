import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';

const WEIXIN_DOMAIN = 'mp.weixin.qq.com';
const WEIXIN_HOME = 'https://mp.weixin.qq.com/';

async function getToken(page) {
    return page.evaluate('(window.location.href.match(/token=(\\d+)/)||[])[1]');
}

async function navigateToEditor(page) {
    await page.goto(WEIXIN_HOME);
    await page.wait(3);
    const token = await getToken(page);
    if (!token) {
        throw new CommandExecutionError('Could not extract session token. Please log in to mp.weixin.qq.com');
    }
    await page.goto(`https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=77&token=${token}&lang=zh_CN`);
    // 等 ProseMirror 编辑器就绪（新版编辑器已不用 UEditor）
    for (let i = 0; i < 15; i++) {
        const found = await page.evaluate(`!!document.querySelector('.ProseMirror')`);
        if (found) break;
        await page.wait(1);
    }
    await page.wait(2);
}

/**
 * 填 React 受控 textarea / input（不是 ProseMirror 的 input/textarea）。
 * - 用 native value setter 写值（绕过 React 的 controlled value 拦截）
 * - 派发 input 事件（React 17+ 监听原生 input）
 * - **不 blur** —— blur 会让某些 onChange 误判为用户离开而丢失同步
 */
async function fillTextInput(page, selector, value) {
    return page.evaluate(`(() => {
        var el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return { ok: false, reason: 'not found: ' + ${JSON.stringify(selector)} };
        el.focus();
        var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        var setter = Object.getOwnPropertyDescriptor(proto, 'value');
        if (setter && setter.set) setter.set.call(el, ${JSON.stringify(value)});
        else el.value = ${JSON.stringify(value)};
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return { ok: true };
    })()`);
}

/**
 * 填 ProseMirror 编辑器（新版微信标题/正文都是 ProseMirror）。
 * ProseMirror 不响应 execCommand，但**拦截 beforeinput**，会自己处理 transaction。
 * 步骤：
 *   1) focus
 *   2) 选区覆盖全文
 *   3) 派发 beforeinput { inputType: 'deleteContentBackward' } 清空
 *   4) 再选区覆盖全文（兜底 execCommand delete）
 *   5) 派发 beforeinput { inputType: 'insertText', data: text }
 *   6) 派发 input 事件同步 React state mirror
 */
async function fillProseMirror(page, selector, text) {
    const result = await page.evaluate(`(async () => {
        var el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return { ok: false, reason: 'not found: ' + ${JSON.stringify(selector)} };
        el.scrollIntoView({ block: 'center' });
        el.focus();

        var sel = window.getSelection();
        var range = document.createRange();

        // 清空
        range.selectNodeContents(el);
        sel.removeAllRanges();
        sel.addRange(range);
        var cleared = el.dispatchEvent(new InputEvent('beforeinput', {
            bubbles: true, cancelable: true,
            inputType: 'deleteContentBackward',
        }));
        // 兜底：execCommand delete
        if ((el.innerText || '').length > 0) {
            range.selectNodeContents(el);
            sel.removeAllRanges();
            sel.addRange(range);
            try { document.execCommand('delete', false); } catch (e) {}
        }
        // 强制清空兜底
        if ((el.innerText || '').length > 0) {
            el.innerHTML = '';
            el.dispatchEvent(new Event('input', { bubbles: true }));
        }

        // 把光标移到末尾，准备插入
        range.selectNodeContents(el);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);

        // 派发 insertText（ProseMirror 拦截 beforeinput）
        var beforeInput = new InputEvent('beforeinput', {
            bubbles: true, cancelable: true,
            inputType: 'insertText',
            data: ${JSON.stringify(text)},
        });
        el.dispatchEvent(beforeInput);
        el.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            data: ${JSON.stringify(text)},
        }));
        // 兜底：execCommand insertText（老版 UEditor 仍可能用）
        if ((el.innerText || '').length < ${JSON.stringify(text)}.length / 2) {
            try {
                document.execCommand('insertText', false, ${JSON.stringify(text)});
            } catch (e) {}
        }
        return { ok: true, textLen: (el.innerText || '').length };
    })()`);
    // 等 ProseMirror 完成 transaction 渲染
    await page.wait(1);
    return result;
}

async function uploadContentImage(page, imagePath) {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const absPath = path.default.resolve(imagePath);
    if (!fs.default.existsSync(absPath)) {
        throw new CommandExecutionError(`Image not found: ${absPath}`);
    }
    if (!page.setFileInput) {
        throw new CommandExecutionError('Image upload requires Browser Bridge with CDP support');
    }

    // 新版：#js_editor_insertimage 还在，但 .tpl_item_dropdown jsInsertIcon img 更稳定
    await page.evaluate(`(() => {
        var li = document.querySelector('#js_editor_insertimage')
            || document.querySelector('.jsInsertIcon.img');
        if (li) li.click();
    })()`);
    await page.wait(1);
    // 选"本地上传"第一个 item
    await page.evaluate(`(() => {
        var items = document.querySelectorAll('.js_img_dropdown_menu .tpl_dropdown_menu_item, .js_img_dropdown_menu li');
        for (var i = 0; i < items.length; i++) {
            var t = (items[i].textContent || '').trim();
            if (t.includes('本地上传') || t.includes('上传')) { items[i].click(); return; }
        }
        if (items[0]) items[0].click();
    })()`);
    await page.wait(1);

    await page.setFileInput([absPath], 'input[type="file"][name="file"]');
    await page.wait(8);

    // ProseMirror 编辑器：找 .rich_media_content.ProseMirror 或 #ueditor_0 兼容
    const cdnCount = await page.evaluate(`(() => {
        var editor = document.querySelector('.rich_media_content')
            || document.querySelector('#ueditor_0');
        return editor ? editor.querySelectorAll('img[src*="mmbiz"]').length : 0;
    })()`);
    if (cdnCount === 0) {
        throw new CommandExecutionError('Image did not upload to WeChat CDN');
    }
}

async function selectCoverFromContent(page) {
    await page.evaluate('document.querySelector("#js_cover_area")?.scrollIntoView()');
    await page.wait(1);

    await page.evaluate('document.querySelector(".js_cover_btn_area")?.click()');
    await page.wait(1);

    // 关键修复：包含匹配而不是严格相等。新版文字是"从正文选择可选视频封面"
    await page.evaluate(`(() => {
        var links = document.querySelectorAll('a.pop-opr__button, button.pop-opr__button');
        for (var i = 0; i < links.length; i++) {
            var t = (links[i].textContent || '').trim();
            if (t.includes('从正文选择')) { links[i].click(); return; }
        }
    })()`);
    await page.wait(2);

    await page.evaluate(`(() => {
        // 新版可能没有 .weui-desktop-dialog_img-picker 包裹，用更通用的选择器
        var img = document.querySelector('.appmsg_content_img')
            || document.querySelector('.weui-desktop-dialog img[src*="mmbiz"]')
            || document.querySelector('.weui-desktop-dialog_img-picker .appmsg_content_img');
        if (img) img.click();
    })()`);
    await page.wait(1);

    await page.evaluate(`(() => {
        var btns = document.querySelectorAll('button');
        for (var i = 0; i < btns.length; i++) {
            if ((btns[i].textContent || '').trim() === '下一步' && !btns[i].disabled) { btns[i].click(); return; }
        }
    })()`);

    // Crop dialog 渲染慢
    for (let attempt = 0; attempt < 8; attempt++) {
        await page.wait(2);
        const ready = await page.evaluate(`(() => {
            var btns = document.querySelectorAll('button');
            for (var i = 0; i < btns.length; i++) {
                if ((btns[i].textContent || '').trim() === '确认' && btns[i].offsetHeight > 0 && !btns[i].disabled) return true;
            }
            return false;
        })()`);
        if (ready) break;
    }

    await page.evaluate(`(() => {
        var btns = document.querySelectorAll('button');
        for (var i = 0; i < btns.length; i++) {
            if ((btns[i].textContent || '').trim() === '确认' && btns[i].offsetHeight > 0 && !btns[i].disabled) { btns[i].click(); return; }
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
        { name: 'timeout', type: 'int', required: false, default: 180, help: 'Max seconds for the overall command (default: 180)' },
    ],
    columns: ['status', 'detail'],

    func: async (page, kwargs) => {
        await navigateToEditor(page);

        // 1) 标题：填 ProseMirror 那个（新版真正显示的）
        const titleResult = await fillProseMirror(page, '.title-editor__input .ProseMirror', kwargs.title);
        if (!titleResult?.ok) {
            // 兜底：填 textarea#title
            const fallback = await fillTextInput(page, 'textarea#title', kwargs.title);
            if (!fallback?.ok) throw new CommandExecutionError('Failed to fill title');
        }

        if (kwargs.author) {
            const authorResult = await fillTextInput(page, 'input#author', kwargs.author);
            if (!authorResult?.ok) throw new CommandExecutionError('Failed to fill author');
        }

        // 2) 正文：填 ProseMirror rich_media_content
        const contentResult = await fillProseMirror(page, '.rich_media_content.ProseMirror, .rich_media_content .ProseMirror', kwargs.content);
        if (!contentResult?.ok) throw new CommandExecutionError('Failed to fill content');

        if (kwargs['cover-image']) {
            await uploadContentImage(page, kwargs['cover-image']);
            const coverSet = await selectCoverFromContent(page);
            if (!coverSet) {
                // Non-fatal: draft can be saved without cover
            }
        }

        if (kwargs.summary) {
            await fillTextInput(page, 'textarea#js_description', kwargs.summary);
        }

        // 验证 ProseMirror 状态：标题/正文真的进了 state 吗？
        const verify = await page.evaluate(`(() => {
            var t = document.querySelector('.title-editor__input .ProseMirror');
            var c = document.querySelector('.rich_media_content.ProseMirror, .rich_media_content .ProseMirror');
            var tt = document.querySelector('textarea#title');
            return {
                titleLen: t ? (t.innerText || '').length : 0,
                contentLen: c ? (c.innerText || '').length : 0,
                titleText: t ? (t.innerText || '').slice(0, 40) : '',
                contentText: c ? (c.innerText || '').slice(0, 40) : '',
                textareaTitleValue: tt ? (tt.value || '').slice(0, 40) : '(no textarea#title)',
            };
        })()`);
        if (verify.titleLen === 0 || verify.contentLen === 0) {
            throw new CommandExecutionError(
                `ProseMirror state not synced: title_len=${verify.titleLen}, content_len=${verify.contentLen}. ` +
                `title="${verify.titleText}" content="${verify.contentText}"`
            );
        }

        // 同时填 textarea#title（某些版本保存读取的是 textarea 镜像，不是 ProseMirror DOM）
        await fillTextInput(page, 'textarea#title', kwargs.title);

        // 让 ProseMirror 完成 transaction 渲染，React 同步 state
        await page.wait(3);
        const success = await clickSaveDraft(page);

        // 保存后等 3s 让微信返回实际状态，然后读 page 反映
        await page.wait(3);
        const postSave = await page.evaluate(`(() => {
            var t = document.querySelector('.title-editor__input .ProseMirror');
            var c = document.querySelector('.rich_media_content.ProseMirror, .rich_media_content .ProseMirror');
            var tt = document.querySelector('textarea#title');
            var url = window.location.href;
            var appmsgidMatch = url.match(/appmsgid=(\\d+)/);
            return {
                titleLen: t ? (t.innerText || '').length : 0,
                contentLen: c ? (c.innerText || '').length : 0,
                textareaTitleValue: tt ? (tt.value || '').slice(0, 40) : '',
                bodyHasUnsavedWarning: document.body.innerText.includes('未保存'),
                url: url,
                appmsgid: appmsgidMatch ? appmsgidMatch[1] : null,
            };
        })()`);

        return [{
            status: success ? 'draft saved' : 'save attempted, check browser to confirm',
            detail: `"${kwargs.title}"${kwargs.author ? ` by ${kwargs.author}` : ''}${kwargs['cover-image'] ? ' (with cover)' : ''} appmsgid=${postSave.appmsgid || '?'} title_len=${verify.titleLen} content_len=${verify.contentLen} pm_title_len_after_save=${postSave.titleLen} content_len_after_save=${postSave.contentLen}`,
        }];
    },
});
