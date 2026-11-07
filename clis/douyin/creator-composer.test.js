import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { JSDOM } from 'jsdom';
import { getRegistry } from '@jackwener/opencli/registry';
import { buildRetainCoverInputJs, readState, runComposer, validateOptions, verifyComposer } from './_shared/creator-composer.js';
import './publish-images.js';
import './publish-article.js';

let directory;
let image;
let bodyFile;
beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-douyin-composer-'));
    image = path.join(directory, 'one.png');
    bodyFile = path.join(directory, 'article.txt');
    fs.writeFileSync(image, Buffer.from('synthetic-test-image'));
    fs.writeFileSync(bodyFile, '段落一\n\n段落二');
});
afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

function args(kind = 'image', extra = {}) {
    return { images: image, 'body-file': bodyFile, title: '测试标题', caption: '正文', visibility: 'private', ...extra };
}

function fixture(kind = 'image', { receipt = 'none', guard = '' } = {}) {
    const dom = new JSDOM('<body></body>', { url: 'https://creator.douyin.com/creator-micro/home', runScripts: 'outside-only' });
    const { window } = dom;
    const { document } = window;
    Object.defineProperty(window.HTMLElement.prototype, 'innerText', {
        get() { return this.textContent; }, set(v) { this.textContent = v; }, configurable: true,
    });
    window.HTMLElement.prototype.getClientRects = () => [{ width: 100, height: 30 }];
    let submits = 0;
    const composer = () => {
        dom.reconfigure({ url: `https://creator.douyin.com/creator-micro/content/post/${kind}` });
        document.body.innerHTML = `
          <input placeholder="${kind === 'image' ? '添加作品标题' : '请输入文章标题，最多不超过30个字'}">
          <input placeholder="添加内容摘要或文章精彩部分">
          <div contenteditable="true"></div>
          ${kind === 'image' ? '<div>已添加1张图片</div>' : ''}
          <div class="content-section"><div><span>封面设置</span>*</div>
            <div class="content-upload-fixture"><div class="addIcon-cover">+</div></div></div>
          <label><input type="checkbox">公开</label>
          <label><input type="checkbox">好友可见</label>
          <label><input type="checkbox" checked>仅自己可见</label>
          <label><input type="checkbox" checked>立即发布</label>
          <button id="submit">发布</button><button id="draft">暂存离开</button>${guard}`;
        document.querySelectorAll('label').forEach(label => label.onclick = () => {
            if (label.textContent.trim() === '立即发布') return;
            document.querySelectorAll('label').forEach(other => {
                if (other.textContent.trim() !== '立即发布') other.querySelector('input').checked = false;
            });
            label.querySelector('input').checked = true;
        });
        const submit = () => {
            submits++;
            if (receipt === 'throw') throw new Error('simulated connection loss');
            if (receipt === 'success') {
                dom.reconfigure({ url: 'https://creator.douyin.com/creator-micro/content/manage' });
                document.body.innerHTML = '<div role="alert">发布成功</div>';
            }
            if (receipt === 'navigation-only') dom.reconfigure({ url: 'https://creator.douyin.com/creator-micro/content/manage' });
        };
        document.querySelector('#submit').onclick = submit;
        document.querySelector('#draft').onclick = submit;
        document.querySelector('.addIcon-cover').onclick = () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.onchange = () => {
                const modal = document.createElement('div');
                modal.className = 'modalContainer-fixture';
                modal.innerHTML = '编辑封面<img><button>完成</button>';
                Object.defineProperty(modal.querySelector('img'), 'complete', { value: true });
                Object.defineProperty(modal.querySelector('img'), 'naturalWidth', { value: 1080 });
                document.body.appendChild(modal);
                modal.querySelector('button').onclick = () => {
                    modal.remove();
                    const cover = document.createElement('img');
                    document.querySelector('.content-upload-fixture').appendChild(cover);
                    const toast = document.createElement('div');
                    toast.setAttribute('role', 'alert');
                    toast.textContent = '保存成功';
                    document.body.appendChild(toast);
                };
            };
            input.click();
        };
    };
    const page = {
        dom, composer, submits: () => submits,
        goto: vi.fn(async () => {
            if (kind === 'article') composer();
            else document.body.innerHTML = '<input type="file" multiple>';
        }),
        evaluate: vi.fn(async script => window.eval(script)),
        wait: vi.fn(async () => {}),
        setFileInput: vi.fn(async (_files, selector) => {
            if (selector.includes('multiple')) composer();
            else document.querySelector(selector).dispatchEvent(new window.Event('change'));
        }),
        fillText: vi.fn(async (selector, value) => {
            const target = document.querySelector(selector);
            if (target.tagName === 'INPUT') target.value = value;
            else target.textContent = value;
            return { verified: true };
        }),
    };
    return page;
}

describe('Douyin image/article validation', () => {
    it('registers separate write commands without altering video publish', () => {
        for (const command of ['publish-images', 'publish-article']) {
            const definition = getRegistry().get(`douyin/${command}`);
            expect(definition.access).toBe('write');
            expect(definition.siteSession).toBe('persistent');
            expect(definition.navigateBefore).toBe(false);
            expect(definition.args.find(a => a.name === 'publish').default).toBe(false);
            expect(definition.args.find(a => a.name === 'visibility').default).toBe('private');
        }
    });
    it('retains plain-text paragraphs and supports a 35-image set', () => {
        expect(validateOptions('article', args('article')).body).toBe('段落一\n\n段落二');
        const images = Array.from({ length: 35 }, (_, i) => {
            const filename = path.join(directory, `${i}.png`); fs.copyFileSync(image, filename); return filename;
        });
        expect(validateOptions('image', args('image', { images: images.join(',') })).images).toHaveLength(35);
        expect(() => validateOptions('image', args('image', { images: [...images, image].join(',') }))).toThrow('1–35');
    });
    it.each([
        ['overlong image title', 'image', { title: '字'.repeat(21) }],
        ['overlong caption', 'image', { caption: '字'.repeat(1001) }],
        ['invalid visibility', 'image', { visibility: 'wrong' }],
        ['conflicting actions', 'image', { publish: true, 'save-draft': true }],
        ['missing cover on publish', 'article', { publish: true }],
        ['missing cover on draft', 'article', { 'save-draft': true }],
        ['overlong article title', 'article', { title: '字'.repeat(31) }],
        ['overlong summary', 'article', { summary: '字'.repeat(31) }],
    ])('rejects %s before navigation', (_name, kind, overrides) => {
        expect(() => validateOptions(kind, args(kind, overrides))).toThrow();
    });
    it('rejects duplicate/missing/empty/GIF/directory/oversize image files', () => {
        expect(() => validateOptions('image', args('image', { images: `${image},${image}` }))).toThrow();
        for (const filename of ['missing.png', 'empty.png', 'bad.gif', 'directory.png', 'big.png']) {
            const p = path.join(directory, filename);
            if (filename === 'directory.png') fs.mkdirSync(p);
            else if (filename !== 'missing.png') fs.writeFileSync(p, '');
            if (filename === 'big.png') fs.truncateSync(p, 50 * 1024 * 1024 + 1);
            expect(() => validateOptions('image', args('image', { images: p }))).toThrow();
        }
    });
    it('rejects empty, binary, invalid UTF-8 and overlong article files', () => {
        for (const content of ['', '字'.repeat(20001), '\0bad', Buffer.from([0xff])]) {
            fs.writeFileSync(bodyFile, content);
            expect(() => validateOptions('article', args('article'))).toThrow();
        }
    });
});

describe('Douyin creator production paths', () => {
    it.each(['image', 'article'])('prepares %s without clicking submit/save', async kind => {
        const page = fixture(kind);
        const options = validateOptions(kind, args(kind));
        const result = await runComposer(page, options);
        expect(result[0]).toMatchObject({ status: 'prepared', submitted: false });
        expect(page.submits()).toBe(0);
        expect((await readState(page, kind)).body).toBe(options.body);
        page.dom.window.close();
    });
    it('uploads/crops article cover, restores prototype and removes transient inputs', async () => {
        const page = fixture('article');
        const originalClick = page.dom.window.HTMLInputElement.prototype.click;
        const result = await runComposer(page, validateOptions('article', args('article', { cover: image })));
        expect(result[0].status).toBe('prepared');
        expect(page.dom.window.HTMLInputElement.prototype.click).toBe(originalClick);
        expect(page.dom.window.document.querySelector('[data-opencli-douyin-file]')).toBeNull();
        expect(page.submits()).toBe(0);
        page.dom.window.close();
    });
    it('uses native editor input without the zero-width-leaf DOM fallback', async () => {
        const page = fixture('article');
        page.insertText = vi.fn(async text => {
            const editor = page.dom.window.document.querySelector('[contenteditable="true"]');
            editor.replaceChildren(...text.split('\n').map(line => {
                const p = page.dom.window.document.createElement('p');
                p.textContent = line;
                return p;
            }));
        });
        const options = validateOptions('article', args('article'));
        const result = await runComposer(page, options);
        expect(result[0].status).toBe('prepared');
        expect(page.insertText).toHaveBeenCalledExactlyOnceWith(options.body);
        expect((await readState(page, 'article')).body).toBe(options.body);
        page.dom.window.close();
    });
    it('does not accept the crop dialog preview as a committed cover', async () => {
        const page = fixture('article');
        page.composer();
        await page.evaluate(buildRetainCoverInputJs());
        await page.setFileInput([image], 'input[data-opencli-douyin-file="1"]');
        const state = await readState(page, 'article');
        expect(state.coverDialog).toBe(true);
        expect(state.coverDecoded).toBe(true);
        expect(state.coverReady).toBe(false);
        page.dom.window.close();
    });
    it('waits for image decoding before clicking the crop completion button', async () => {
        const page = fixture('article');
        const evaluate = page.evaluate;
        let waitingReads = 0;
        page.evaluate = vi.fn(async code => {
            const state = await evaluate(code);
            if (state?.coverDialog && waitingReads++ < 2) return { ...state, coverDecoded: false };
            return state;
        });
        const result = await runComposer(page, validateOptions('article', args('article', { cover: image })));
        expect(waitingReads).toBeGreaterThanOrEqual(3);
        expect(result[0].status).toBe('prepared');
        page.dom.window.close();
    });
    it('restores file-input prototype even when cover handler throws', async () => {
        const page = fixture('article');
        page.composer();
        const originalClick = page.dom.window.HTMLInputElement.prototype.click;
        const trigger = page.dom.window.document.querySelector('.addIcon-cover');
        trigger.onclick = null;
        trigger.click = () => { throw new Error('upload failed'); };
        await expect(page.evaluate(buildRetainCoverInputJs())).rejects.toThrow('upload failed');
        expect(page.dom.window.HTMLInputElement.prototype.click).toBe(originalClick);
        page.dom.window.close();
    });
    it('does not overwrite a nonempty existing composer', async () => {
        const page = fixture();
        page.composer();
        page.dom.window.document.querySelector('input').value = '用户未保存内容';
        await expect(runComposer(page, validateOptions('image', args()))).rejects.toThrow('未提交编辑');
        expect(page.goto).not.toHaveBeenCalled();
        page.dom.window.close();
    });
    it('stops before submission on title/body/media/visibility mismatch', async () => {
        const options = validateOptions('image', args());
        const state = { trusted: true, composer: true, title: options.title, body: options.body, imageCount: 1, visibility: ['仅自己可见', '立即发布'] };
        for (const patch of [{ title: 'changed' }, { body: 'changed' }, { imageCount: 2 }, { visibility: ['公开'] }, { visibility: ['仅自己可见', '定时发布'] }, { visibility: ['公开', '仅自己可见', '立即发布'] }]) {
            expect(() => verifyComposer({ ...state, ...patch }, options)).toThrow('未提交');
        }
    });
    it('does not replace unsaved work in the other composer kind', async () => {
        const page = fixture('article');
        page.composer();
        page.dom.window.document.querySelector('input').value = '未保存文章';
        await expect(runComposer(page, validateOptions('image', args()))).rejects.toThrow('未提交编辑');
        expect(page.goto).not.toHaveBeenCalled();
        page.dom.window.close();
    });
    it.each(['验证码', '扫码登录'])('fails closed on %s', async guard => {
        const page = fixture('article', { guard });
        await expect(runComposer(page, validateOptions('article', args('article')))).rejects.toThrow();
        expect(page.submits()).toBe(0);
        page.dom.window.close();
    });
    it('explicit publish clicks once and distinguishes submission from public visibility', async () => {
        const page = fixture('image', { receipt: 'success' });
        const result = await runComposer(page, validateOptions('image', args('image', { publish: true })));
        expect(page.submits()).toBe(1);
        expect(result[0]).toMatchObject({ status: 'submitted', submitted: true });
        expect(result[0]).not.toHaveProperty('aweme_id');
        page.dom.window.close();
    });
    it.each(['none', 'navigation-only'])('returns uncertain without retry on %s', async receipt => {
        const page = fixture('article', { receipt });
        // Crop generates a "保存成功" toast, which must not confirm the later publication.
        const result = await runComposer(page, validateOptions('article', args('article', { cover: image, publish: true })));
        expect(page.submits()).toBe(1);
        expect(result[0]).toMatchObject({ status: 'uncertain', submitted: null });
        page.dom.window.close();
    });
    it('never retries after transport loss on the final click', async () => {
        const page = fixture();
        const evaluate = page.evaluate;
        let attempts = 0;
        page.evaluate = vi.fn(async code => {
            if (code.includes('matches[0].click') && code.includes('"发布"')) {
                attempts++; throw new Error('token=DO_NOT_LEAK');
            }
            return evaluate(code);
        });
        const result = await runComposer(page, validateOptions('image', args('image', { publish: true })));
        expect(attempts).toBe(1);
        expect(result[0].status).toBe('uncertain');
        expect(JSON.stringify(result)).not.toContain('DO_NOT_LEAK');
        page.dom.window.close();
    });
});
