import * as fs from 'node:fs';
import * as path from 'node:path';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';

const WEIXIN_DOMAIN = 'mp.weixin.qq.com';
const WEIXIN_HOME = 'https://mp.weixin.qq.com/';
const MIME_TYPES = {
    '.bmp': 'image/bmp',
    '.gif': 'image/gif',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
};

async function getToken(page) {
    return page.evaluate(`(window.location.href.match(/token=(\\d+)/)||[])[1]`);
}

async function navigateToStickerEditor(page) {
    await page.goto(WEIXIN_HOME);
    await page.wait(3);
    const token = await getToken(page);
    if (!token) {
        throw new CommandExecutionError('Could not extract session token. Please log in to mp.weixin.qq.com');
    }
    await page.goto(`https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit_v2&action=edit&isNew=1&type=77&createType=8&token=${token}&lang=zh_CN`);
    await page.wait(4);
    const ready = await page.evaluate(`!!document.querySelector('.image-selector')`);
    if (!ready) {
        throw new CommandExecutionError('Sticker editor did not load. Session may have expired');
    }
}

async function fillTitle(page, title) {
    if (!title) return true;
    const result = await page.evaluate(`(() => {
        var title = ${JSON.stringify(title)};
        var el = document.querySelector('textarea#title, #title, .js_title');
        if (el) {
            el.focus();
            var proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
            var setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
            if (setter) setter.call(el, title);
            else el.value = title;
            el.dispatchEvent(new InputEvent('input', { bubbles: true, data: title }));
            el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new Event('blur', { bubbles: true }));
            el.blur();
        }

        if (window.wx && window.wx.ueditor && window.wx.ueditor.titleEditor) {
            window.wx.ueditor.titleEditor.setContent(title);
        }
        if (window.wx && window.wx.ueditor && typeof window.wx.ueditor.fireEvent === 'function') {
            window.wx.ueditor.fireEvent('setCurrentAritleTitle', title);
            window.wx.ueditor.fireEvent('updateTitleStatus', { title });
        }

        var titlePlace = document.querySelector('.js_title_place');
        if (titlePlace) titlePlace.textContent = title;
        var parent = document.querySelector('#js_content_top')?.__vue__ || document.querySelector('.image-selector')?.__vue__?.$parent;
        if (parent && parent.articleData) {
            parent.articleData.title = title;
            parent.articleData.is_user_title = 1;
        }
        return { ok: !!(el || (window.wx && window.wx.ueditor && window.wx.ueditor.titleEditor) || (parent && parent.articleData)) };
    })()`);
    return result === true || result?.ok === true;
}

async function fillDescription(page, text) {
    if (!text) return true;
    return page.evaluate(`(() => {
        var editor = document.querySelector('.share-text__input .ProseMirror');
        if (!editor) return false;
        editor.focus();
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, ${JSON.stringify(text)});
        editor.dispatchEvent(new InputEvent('input', { bubbles: true, data: ${JSON.stringify(text)} }));
        return true;
    })()`);
}

function readStickerImage(imagePath) {
    const absPath = path.resolve(imagePath);
    if (!fs.existsSync(absPath)) {
        throw new CommandExecutionError(`Image not found: ${absPath}`);
    }
    const ext = path.extname(absPath).toLowerCase();
    const mime = MIME_TYPES[ext];
    if (!mime) {
        throw new CommandExecutionError(`Unsupported sticker image format "${ext}". Supported: ${Object.keys(MIME_TYPES).join(', ')}`);
    }

    return {
        name: path.basename(absPath),
        mime,
        base64: fs.readFileSync(absPath).toString('base64'),
    };
}

async function uploadStickerImageFile(page, image) {
    return page.evaluate(`
        (async img => {
            const data = (window.wx && window.wx.commonData && window.wx.commonData.data)
                || (window.wx && window.wx.data)
                || {};
            const selector = document.querySelector('.image-selector');
            const vm = selector && selector.__vue__;
            const query = (vm && vm.uploadQuery) || { scene: 5, writetype: 'doublewrite', groupid: 1 };
            if (!data.user_name || !data.ticket || !data.time) {
                return { ok: false, error: 'WeChat upload ticket is unavailable' };
            }

            const params = new URLSearchParams({
                ticket_id: data.user_name,
                ticket: data.ticket,
                svr_time: data.time,
            });
            Object.keys(query).forEach(key => params.set(key, query[key]));
            const url = new URL('/cgi-bin/filetransfer?action=upload_material&f=json&' + params.toString(), location.origin).toString();

            const binary = atob(img.base64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            const file = new File([new Blob([bytes], { type: img.mime })], img.name, { type: img.mime });
            const form = new FormData();
            form.append('file', file);

            const response = await fetch(url, { method: 'POST', body: form, credentials: 'include' });
            const text = await response.text();
            let json = null;
            try { json = JSON.parse(text); } catch (_) {}
            if (!response.ok) {
                return { ok: false, error: 'HTTP ' + response.status, body: text.slice(0, 500) };
            }
            if (!json || !json.base_resp || json.base_resp.ret !== 0) {
                return {
                    ok: false,
                    error: (json && json.base_resp && (json.base_resp.err_msg || json.base_resp.ret)) || 'unknown upload error',
                    response: json,
                };
            }
            if (!json.content || !json.cdn_url) {
                return { ok: false, error: 'upload response missing file id or cdn url', response: json };
            }

            if (window.wx && typeof window.wx.getSeq === 'function') {
                fetch('/cgi-bin/modifyfile?oper=updaterecent&fileid=' + encodeURIComponent(json.content) + '&seq=' + encodeURIComponent(window.wx.getSeq()), {
                    credentials: 'include',
                }).catch(() => {});
            }
            return { ok: true, fileId: Number(json.content), cdnUrl: json.cdn_url };
        })(${JSON.stringify(image)})
    `);
}

async function attachStickerImage(page, uploaded) {
    return page.evaluate(`
        (async uploaded => {
            const selector = document.querySelector('.image-selector');
            const vm = selector && selector.__vue__;
            if (!vm) return { ok: false, error: 'sticker image selector not found' };

            vm.innerList = [{
                file_id: uploaded.fileId,
                cdn_url: uploaded.cdnUrl,
                url: uploaded.cdnUrl,
                loading: false,
            }];
            if (typeof vm.formatList === 'function') await vm.formatList();
            await new Promise(resolve => vm.$nextTick(resolve));
            if (vm.innerList.length) vm.selected = vm.innerList[vm.innerList.length - 1].seq;
            if (typeof vm.onChange === 'function') vm.onChange();
            if (typeof vm.updateRecommendTopic === 'function') vm.updateRecommendTopic();
            await new Promise(resolve => vm.$nextTick(resolve));

            return {
                ok: vm.innerList.length > 0 && typeof vm.innerList[0].file_id === 'number',
            };
        })(${JSON.stringify(uploaded)})
    `);
}

async function uploadStickerImage(page, imagePath) {
    const image = readStickerImage(imagePath);
    const uploaded = await uploadStickerImageFile(page, image);
    if (!uploaded?.ok) {
        throw new CommandExecutionError(`Sticker image upload failed: ${uploaded?.error || 'unknown'}`);
    }

    const attached = await attachStickerImage(page, uploaded);
    if (!attached?.ok) {
        throw new CommandExecutionError(`Sticker image did not attach to editor: ${attached?.error || 'unknown'}`);
    }
}

async function clickSaveDraft(page) {
    const result = await page.evaluate(`(() => {
        var btn = document.querySelector('#js_submit button') || document.querySelector('#js_submit');
        if (btn) { btn.click(); return { ok: true }; }
        var nodes = document.querySelectorAll('span, button, a');
        for (var i = 0; i < nodes.length; i++) {
            if ((nodes[i].textContent || '').trim() === '保存为草稿') { nodes[i].click(); return { ok: true }; }
        }
        return { ok: false };
    })()`);
    if (!result?.ok) throw new CommandExecutionError('Save sticker draft button not found');

    for (let attempt = 0; attempt < 5; attempt++) {
        await page.wait(2);
        const saved = await page.evaluate(`(() => {
            var text = document.body.innerText || '';
            return text.includes('已保存') || text.includes('保存成功') || !!document.querySelector('#js_save_success');
        })()`);
        if (saved) return true;
    }
    return false;
}

export const createStickerCommand = cli({
    site: 'weixin',
    name: 'create-sticker',
    access: 'write',
    description: '创建微信公众号贴图草稿',
    domain: WEIXIN_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'content', required: false, positional: true, help: '贴图描述 (最多1000字)' },
        { name: 'image', required: true, help: '贴图图片路径 (bmp/gif/jpg/png/webp)' },
        { name: 'title', required: false, help: '贴图标题 (最多20字，选填)' },
        { name: 'timeout', type: 'int', required: false, default: 180, help: 'Max seconds for the overall command (default: 180)' },
    ],
    columns: ['status', 'detail'],

    func: async (page, kwargs) => {
        const title = String(kwargs.title || '').trim();
        const content = String(kwargs.content || '').trim();
        if (!kwargs.image) throw new CommandExecutionError('--image is required');
        if (title.length > 20) throw new CommandExecutionError('Sticker title must be ≤ 20 chars');
        if (content.length > 1000) throw new CommandExecutionError('Sticker description must be ≤ 1000 chars');

        await navigateToStickerEditor(page);
        await uploadStickerImage(page, kwargs.image);
        if (!(await fillTitle(page, title))) throw new CommandExecutionError('Failed to fill sticker title');
        if (!(await fillDescription(page, content))) throw new CommandExecutionError('Failed to fill sticker description');
        const success = await clickSaveDraft(page);

        return [{
            status: success ? 'sticker draft saved' : 'save attempted, check browser to confirm',
            detail: `"${title || path.basename(kwargs.image)}" (sticker)`,
        }];
    },
});
