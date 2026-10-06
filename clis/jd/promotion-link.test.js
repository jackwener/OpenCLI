import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, TimeoutError } from '@jackwener/opencli/errors';
import { normalizePromotionArgs, promotionDom, requireLongPromotionUrl } from './promotion-link.js';

const FORM = readFileSync(new URL('./__fixtures__/promotion-form.html', import.meta.url), 'utf8');
const PAGE = 'https://union.jd.com/proManager/custompromotion';
const ARGS = { sku: '100291143898', website: '示例网站', position: '示例推广位', timeout: 2 };
const LONG_URL = 'https://union-click.jd.com/jdc?e=example-product';
const command = getRegistry().get('jd/promotion-link');
const windows = [];

afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    windows.splice(0).forEach(window => window.close());
});

/** 表单来自真实页面；事件模拟仅补充 Vue 在浏览器中的交互行为。 */
function loadForm() {
    const dom = new JSDOM(`<div id="tab-customlink" role="tab" aria-selected="false">自定义链接推广</div>${FORM}`, {
        url: PAGE, runScripts: 'outside-only',
    });
    windows.push(dom.window);
    const doc = dom.window.document;
    const pane = doc.querySelector('#pane-customlink');
    pane.style.display = 'none';
    doc.querySelector('#tab-customlink').addEventListener('click', event => {
        event.currentTarget.setAttribute('aria-selected', 'true');
        pane.style.display = '';
    });
    doc.querySelector('textarea').value = '';
    for (const field of doc.querySelectorAll('.el-form-item')) {
        const input = field.querySelector('.el-select input');
        const dropdown = field.querySelector('.el-select-dropdown');
        if (!input || !dropdown) continue;
        input.addEventListener('click', () => { dropdown.style.display = ''; });
        for (const option of dropdown.querySelectorAll('.el-select-dropdown__item')) {
            option.addEventListener('click', () => {
                input.value = option.textContent.trim();
                dropdown.style.display = 'none';
            });
        }
    }
    return dom;
}

/** 结果结构按京东公开前端的 promotionResult 渲染器构造，尚非真实转链成功采样。 */
function resultDialog(doc, { url = LONG_URL, shortOnly = false, hidden = false } = {}) {
    const holder = doc.createElement('div');
    holder.innerHTML = `<div role="dialog" aria-label="生成推广链接">
        <div role="tab" id="tab-1" aria-selected="false">长链接</div>
        <div role="tab" aria-selected="true">短链接</div>
        <div role="tabpanel" aria-labelledby="tab-1" style="display:none">
            <div class="el-row"><span>优惠券链接</span><input></div>
            <div class="el-row"><span>商品链接</span><input></div>
        </div>
        <div role="tabpanel"><div class="el-row"><span>商品链接</span><input value="https://u.jd.com/example"></div></div>
    </div>`;
    const dialog = holder.firstElementChild;
    dialog.querySelectorAll('input')[0].value = 'https://union-click.jd.com/jdc?e=example-coupon';
    dialog.querySelectorAll('input')[1].value = url;
    const tab = dialog.querySelector('#tab-1');
    tab.addEventListener('click', () => {
        tab.setAttribute('aria-selected', 'true');
        dialog.querySelector('[aria-labelledby="tab-1"]').style.display = '';
    });
    if (shortOnly) tab.remove();
    if (hidden) dialog.style.display = 'none';
    doc.body.append(dialog);
    return dialog;
}

/** 完整命令通过相同的注入函数遍历真实表单 fixture，而非伪造 evaluate 的返回值。 */
function pageHarness({ onGenerate, fillVerified = true, dom = loadForm() } = {}) {
    const doc = dom.window.document;
    const generate = vi.fn(() => {
        if (onGenerate) onGenerate(doc);
        else resultDialog(doc);
    });
    doc.querySelector('button').addEventListener('click', generate);
    return {
        dom, generate,
        page: {
            goto: vi.fn(),
            evaluate: vi.fn(code => dom.window.eval(code)),
            fillText: vi.fn((selector, value) => {
                doc.querySelector(selector).value = value;
                return { verified: fillVerified };
            }),
            wait: vi.fn(async () => {}),
        },
    };
}

/** 为直接抽取测试提供与浏览器相同的 DOM 全局，测试结束后统一恢复。 */
function exposeDom(dom) {
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('location', dom.window.location);
    vi.stubGlobal('getComputedStyle', dom.window.getComputedStyle.bind(dom.window));
}

describe('京东联盟推广长链参数与输出边界', () => {
    it('注册写入命令并声明全部输出字段', () => {
        expect(command).toMatchObject({ strategy: 'ui', browser: true, access: 'write', domain: 'union.jd.com', navigateBefore: false });
        expect(command.columns).toEqual(['sku', 'website', 'position', 'sourceUrl', 'promotionUrl']);
    });

    it('保留字符串 SKU 并清理名称首尾空格', () => {
        expect(normalizePromotionArgs({ ...ARGS, website: ' 示例网站 ', timeout: '30' }))
            .toEqual({ ...ARGS, timeout: 30 });
    });

    it.each([
        { sku: '123;alert(1)' }, { website: ' ' }, { position: '' },
        { timeout: 0 }, { timeout: 121 }, { timeout: 1.5 }, { timeout: 'NaN' },
    ])('在浏览器导航前拒绝非法参数 %j', async overrides => {
        const page = { goto: vi.fn() };
        await expect(command.func(page, { ...ARGS, ...overrides })).rejects.toBeInstanceOf(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });

    it.each(['', 'https://union-click.jd.com/', 'https://item.jd.com/123.html', 'https://u.jd.com/abc', 'http://union-click.jd.com/jdc?e=x',
        'https://union-click.jd.com.evil.example/jdc?e=x', 'https://user:pass@union-click.jd.com/jdc?e=x'])
    ('拒绝普通链接、短链或不可信长链 %s', value => {
        expect(() => requireLongPromotionUrl(value)).toThrow(CommandExecutionError);
    });
});

describe('京东联盟 DOM 流程与失败处理', () => {
    it('操作真实表单 fixture，并只返回当前弹窗的商品长链', async () => {
        const { page, generate, dom } = pageHarness();
        resultDialog(dom.window.document, { hidden: true, url: 'https://union-click.jd.com/jdc?e=stale' });
        const rows = await command.func(page, ARGS);
        expect(rows).toEqual([{ sku: ARGS.sku, website: ARGS.website, position: ARGS.position,
            sourceUrl: `https://item.jd.com/${ARGS.sku}.html`, promotionUrl: LONG_URL }]);
        expect(Object.keys(rows[0])).toEqual(command.columns);
        expect(page.goto).toHaveBeenCalledWith(PAGE);
        expect(dom.window.document.querySelector('textarea').value).toBe(rows[0].sourceUrl);
        expect(dom.window.document.querySelector('input[value="webPromotion"]').checked).toBe(true);
        expect(generate).toHaveBeenCalledTimes(1);
    });

    it('长链标签未选中时，不读取优惠券、短链或隐藏旧结果', () => {
        const dom = loadForm();
        exposeDom(dom);
        resultDialog(dom.window.document, { hidden: true });
        resultDialog(dom.window.document);
        expect(promotionDom('state').linkValue).toBeNull();
        expect(promotionDom('long-tab')).toEqual({ done: true });
        expect(promotionDom('state').linkValue).toBe(LONG_URL);
    });

    it.each(['不存在的网站', '示例网'])('精确匹配网站名称并拒绝无权限或不存在的选项 %s', async website => {
        const { page, generate } = pageHarness();
        await expect(command.func(page, { ...ARGS, website })).rejects.toBeInstanceOf(ArgumentError);
        expect(generate).not.toHaveBeenCalled();
    });

    it('忽略其他字段仍可见的同名下拉选项', async () => {
        const { page, dom } = pageHarness();
        const unrelated = dom.window.document.createElement('div');
        unrelated.innerHTML = '<ul class="el-select-dropdown"><li class="el-select-dropdown__item">示例网站</li></ul>';
        dom.window.document.body.append(unrelated);
        await expect(command.func(page, ARGS)).resolves.toHaveLength(1);
    });

    it('忽略长链面板内隐藏的商品链接行', () => {
        const dom = loadForm();
        exposeDom(dom);
        const dialog = resultDialog(dom.window.document);
        const hiddenRow = dom.window.document.createElement('div');
        hiddenRow.className = 'el-row';
        hiddenRow.style.display = 'none';
        hiddenRow.innerHTML = '<span>商品链接</span><input value="https://union-click.jd.com/jdc?e=hidden">';
        dialog.querySelector('[aria-labelledby="tab-1"]').prepend(hiddenRow);
        promotionDom('long-tab');
        expect(promotionDom('state').linkValue).toBe(LONG_URL);
    });

    it('拒绝同名或禁用的推广位', async () => {
        for (const duplicate of [true, false]) {
            const { page, dom, generate } = pageHarness();
            const option = [...dom.window.document.querySelectorAll('.el-select-dropdown__item')].at(-1);
            if (duplicate) option.after(option.cloneNode(true));
            else option.classList.add('is-disabled');
            await expect(command.func(page, ARGS)).rejects.toBeInstanceOf(ArgumentError);
            expect(generate).not.toHaveBeenCalled();
        }
    });

    it('登录重定向采用认证错误，且不尝试生成', async () => {
        const dom = loadForm();
        dom.reconfigure({ url: 'https://passport.jd.com/new/login.aspx' });
        const { page, generate } = pageHarness({ dom });
        await expect(command.func(page, ARGS)).rejects.toBeInstanceOf(AuthRequiredError);
        expect(generate).not.toHaveBeenCalled();
    });

    it.each(['el-message--error', 'el-message--warning'])('访问频繁时立即失败，不重试生成（%s）', async severity => {
        const { page, generate } = pageHarness({ onGenerate: doc => {
            const message = doc.createElement('div');
            message.className = `el-message ${severity}`;
            message.textContent = '访问频繁，请稍后再试';
            doc.body.append(message);
        } });
        await expect(command.func(page, ARGS)).rejects.toThrow('访问频繁');
        expect(generate).toHaveBeenCalledTimes(1);
        expect(page.wait).not.toHaveBeenCalled();
    });

    it('不将只有短链的结果当作成功', async () => {
        const { page } = pageHarness({ onGenerate: doc => resultDialog(doc, { shortOnly: true }) });
        await expect(command.func(page, ARGS)).rejects.toThrow('未返回长链接');
    });

    it('结果字段中的普通商品链接仍须通过长链校验', async () => {
        const { page } = pageHarness({ onGenerate: doc => resultDialog(doc, { url: 'https://item.jd.com/123.html' }) });
        await expect(command.func(page, ARGS)).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('填表核验失败时不生成', async () => {
        const { page, generate } = pageHarness({ fillVerified: false });
        await expect(command.func(page, ARGS)).rejects.toThrow('未正确写入');
        expect(generate).not.toHaveBeenCalled();
    });

    it('等待结果超时采用超时错误，且只提交一次', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        const { page, generate } = pageHarness({ onGenerate: () => {} });
        page.wait.mockImplementation(async () => { vi.setSystemTime(Date.now() + 250); });
        await expect(command.func(page, ARGS)).rejects.toBeInstanceOf(TimeoutError);
        expect(generate).toHaveBeenCalledTimes(1);
    });
});
