import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { addTaobaoCartOnce } from './cart-action.js';
import { assertTaobaoPageUsable, taobaoPageState } from './page-state.js';
import { getRegistry } from '@jackwener/opencli/registry';
import './add-cart.js';
import './detail.js';
import './search.js';
import './reviews.js';

const doms = [];
afterEach(() => { for (const dom of doms.splice(0)) dom.window.close(); });
function fixture(html, url = 'https://item.taobao.com/item.htm?id=123') {
    const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
    doms.push(dom);
    dom.window.Element.prototype.getBoundingClientRect = () => ({ width: 100, height: 30 });
    const evaluate = script => dom.window.eval(script);
    const page = {
        evaluate: vi.fn(async (script, ...args) => {
            if (typeof script === 'function') {
                return dom.window.eval(`(${script.toString()})(...${JSON.stringify(args)})`);
            }
            return evaluate(script);
        }),
        evaluateOnce: vi.fn(async script => evaluate(script)),
        wait: vi.fn(),
    };
    return { dom, page, document: dom.window.document };
}
function success(document) {
    const node = document.createElement('div');
    node.textContent = '成功加入购物车';
    document.body.append(node);
}
const iconButton = '<div class="EmphasizeButtonList--foo miniWrap--bar"><div class="btnItem--cart"><i class="icon-taobaojiarugouwuche-xianxing"></i></div><div class="btnItem--buy">领券购买</div></div>';
describe('Taobao cart confirmation', () => {
    it.each([iconButton, '<button><span>加入购物车</span></button>'])('clicks one supported control and requires a fresh success message', async html => {
        const f = fixture(html);
        const click = vi.fn(() => success(f.document));
        f.document.querySelector('button, .btnItem--cart').addEventListener('click', click);
        await addTaobaoCartOnce(f.page);
        expect(click).toHaveBeenCalledTimes(1);
        expect(f.page.evaluateOnce).toHaveBeenCalledTimes(1);
        expect(f.dom.window.__opencliCartSuccessBefore).toBeUndefined();
    });
    it.each([
        '<a>去购物车</a>',
        '<button disabled>加入购物车</button>',
        '<div style="display:none">' + iconButton + '</div>',
        '<button>加入购物车</button><button>加入购物车</button>',
    ])('rejects missing, disabled, hidden or ambiguous controls without clicking', async html => {
        const f = fixture(html);
        const click = vi.fn(); f.document.body.addEventListener('click', click);
        await expect(addTaobaoCartOnce(f.page)).rejects.toMatchObject({ code: 'COMMAND_EXEC' });
        expect(click).not.toHaveBeenCalled();
    });
    it.each(['<div>成功加入购物车</div>', '<a>去购物车</a>', '<div hidden>成功加入购物车</div>'])('does not confirm from stale or generic cart text', async extra => {
        const f = fixture(iconButton + extra);
        await expect(addTaobaoCartOnce(f.page)).rejects.toMatchObject({ code: 'COMMAND_EXEC', message: expect.stringContaining('could not be confirmed') });
        expect(f.page.evaluateOnce).toHaveBeenCalledTimes(1);
    });
    it('stops on a login redirect after the click', async () => {
        const f = fixture(iconButton);
        f.document.querySelector('.btnItem--cart').addEventListener('click', () => f.dom.reconfigure({ url: 'https://login.taobao.com/member/login.jhtml' }));
        await expect(addTaobaoCartOnce(f.page)).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    });
    it('never retries a click whose response is lost', async () => {
        const f = fixture(iconButton);
        const click = vi.fn(() => success(f.document));
        f.document.querySelector('.btnItem--cart').addEventListener('click', click);
        const once = f.page.evaluateOnce.getMockImplementation();
        f.page.evaluateOnce.mockImplementation(async script => { await once(script); throw new Error('response lost'); });
        await expect(addTaobaoCartOnce(f.page)).rejects.toThrow('response lost');
        expect(click).toHaveBeenCalledTimes(1);
        expect(f.page.evaluateOnce).toHaveBeenCalledTimes(1);
    });
    it('reports missing specifications as an argument error', async () => {
        const f = fixture(iconButton);
        f.document.querySelector('.btnItem--cart').addEventListener('click', () => f.document.body.insertAdjacentHTML('beforeend', '<div role="alert">请选择规格</div>'));
        await expect(addTaobaoCartOnce(f.page)).rejects.toMatchObject({ code: 'ARGUMENT' });
    });
});
describe('Taobao page state', () => {
    it('supports tsx naming helpers inside the serialized page-state probe', async () => {
        const f = fixture('<title>Example product</title>');
        const toString = vi.spyOn(taobaoPageState, 'toString').mockReturnValue(
            'function taobaoPageState() { const read = __name(() => "ok", "read"); return read(); }',
        );
        try {
            await expect(assertTaobaoPageUsable(f.page)).resolves.toBeUndefined();
        } finally {
            toString.mockRestore();
        }
    });
    it.each([
        ['https://login.taobao.com/member/login.jhtml', '<title>登录</title>', 'AUTH_REQUIRED'],
        ['https://item.taobao.com/punish', '<title>Verification</title>', 'SECURITY_BLOCK'],
        ['https://item.taobao.com/item.htm?id=123', '<title>安全验证</title>', 'SECURITY_BLOCK'],
        ['https://login.taobao.com/member/login.jhtml', '<title>安全验证</title>', 'SECURITY_BLOCK'],
    ])('rejects %s', async (url, html, code) => {
        const f = fixture(html, url);
        await expect(assertTaobaoPageUsable(f.page)).rejects.toMatchObject({ code });
    });
    it('does not mistake product text or redirect query values for a challenge', async () => {
        const f = fixture('<title>验证码软件</title><div>请登录后查看评价。滑块验证工具</div>', 'https://item.taobao.com/item.htm?id=123&redirect=/captcha');
        await expect(assertTaobaoPageUsable(f.page)).resolves.toBeUndefined();
    });
    it.each(['hidden', 'style="display:none"', 'style="opacity:0"'])('ignores a hidden challenge widget: %s', async attr => {
        const f = fixture(`<div ${attr}><div id="nc_1_wrapper"></div></div>`);
        await expect(assertTaobaoPageUsable(f.page)).resolves.toBeUndefined();
    });
    it('detects a visible challenge widget', async () => {
        const f = fixture('<div id="nc_1_wrapper"></div>');
        await expect(assertTaobaoPageUsable(f.page)).rejects.toMatchObject({ code: 'SECURITY_BLOCK' });
    });
    it('detects a visible cross-origin Alibaba punish iframe', () => {
        const src = 'https://h5api.m.goofish.com//h5/mtop.taobao.idle.pc.detail/1.0/_____tmd_____/punish?x5secdata=abc&action=captcha';
        const f = fixture(`<iframe src="${src}"></iframe>`);
        const iframe = f.document.querySelector('iframe');
        iframe.getBoundingClientRect = () => ({ left: 296, top: 126, width: 420, height: 320 });
        Object.defineProperty(iframe, 'contentDocument', { get: () => null });

        expect(f.dom.window.eval(`(${taobaoPageState.toString()})()`)).toBe('blocked');
    });
    it.each([
        '<iframe src="https://www.taobao.com/verify"></iframe>',
        '<div hidden><iframe src="https://h5api.m.goofish.com/_____tmd_____/punish?x5secdata=abc"></iframe></div>',
    ])('ignores ordinary or hidden iframes: %s', html => {
        const f = fixture(html);
        const iframe = f.document.querySelector('iframe');
        iframe.getBoundingClientRect = () => ({ left: 20, top: 30, width: 300, height: 180 });
        Object.defineProperty(iframe, 'contentDocument', { get: () => null });

        expect(f.dom.window.eval(`(${taobaoPageState.toString()})()`)).toBe('ok');
    });
    it('treats a bare NoCaptcha slider handle as a challenge', () => {
        const f = fixture('<div id="nc_1_n1t"><span id="nc_1_n1z">slide</span></div>');
        expect(f.dom.window.eval(`(${taobaoPageState.toString()})()`)).toBe('blocked');
    });
    it('enters the solver in a cross-origin punish iframe instead of accepting ok state', async () => {
        const f = fixture('<iframe></iframe>');
        const iframe = f.document.querySelector('iframe');
        iframe.src = 'https://h5api.m.goofish.com//h5/mtop.taobao.idle.pc.detail/1.0/_____tmd_____/punish?x5secdata=abc&action=captcha';
        iframe.getBoundingClientRect = () => ({ left: 296, top: 126, width: 420, height: 320 });
        Object.defineProperty(iframe, 'contentDocument', { get: () => null });
        f.page.frames = vi.fn().mockResolvedValue([{ index: 7, url: iframe.src, name: '' }]);
        f.page.evaluateInFrame = vi.fn().mockResolvedValue({
            kind: 'slider',
            start: { x: 62, y: 197 },
            distance: 258,
            viewportWidth: 420,
            viewportHeight: 320,
        });
        f.page.cdp = vi.fn(async (_method, params) => {
            if (params?.type === 'mouseReleased') iframe.remove();
        });

        await expect(assertTaobaoPageUsable(f.page)).resolves.toBeUndefined();

        expect(f.page.frames).toHaveBeenCalledTimes(1);
        expect(f.page.evaluateInFrame).toHaveBeenCalledWith(expect.any(String), 7);
        expect(f.page.cdp).toHaveBeenCalledWith('Input.dispatchMouseEvent', expect.objectContaining({
            type: 'mousePressed',
            x: 358,
            y: 323,
        }));
        expect(f.page.cdp).toHaveBeenCalledWith('Input.dispatchMouseEvent', expect.objectContaining({
            type: 'mouseReleased',
        }));
    });
    it('drags a visible slider automatically and continues after it clears', async () => {
        const f = fixture('<div id="nc_1_wrapper"><div id="nc_1_n1t"><span id="nc_1_n1z">slide</span></div></div>');
        const box = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top });
        const wrapper = f.document.querySelector('#nc_1_wrapper');
        const track = f.document.querySelector('#nc_1_n1t');
        const handle = f.document.querySelector('#nc_1_n1z');
        track.getBoundingClientRect = () => box(100, 200, 300, 34);
        handle.getBoundingClientRect = () => box(100, 202, 42, 30);
        f.page.cdp = vi.fn(async (_method, params) => {
            if (params?.type === 'mouseReleased') wrapper.remove();
        });

        await expect(assertTaobaoPageUsable(f.page)).resolves.toBeUndefined();

        expect(f.page.cdp).toHaveBeenCalledWith('Input.dispatchMouseEvent', expect.objectContaining({ type: 'mousePressed' }));
        expect(f.page.cdp).toHaveBeenCalledWith('Input.dispatchMouseEvent', expect.objectContaining({ type: 'mouseReleased' }));
    });
    it.each(['add-cart', 'detail', 'search', 'reviews'])('stops %s before scraping or clicking after a login redirect', async command => {
        const page = { goto: vi.fn(), wait: vi.fn(), autoScroll: vi.fn(), evaluateOnce: vi.fn(), evaluate: vi.fn().mockResolvedValueOnce(undefined).mockResolvedValue('login') };
        await expect(getRegistry().get(`taobao/${command}`).func(page, { id: '123', query: 'test' })).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
        expect(page.evaluate).toHaveBeenCalledTimes(2);
        expect(page.autoScroll).not.toHaveBeenCalled();
        expect(page.evaluateOnce).not.toHaveBeenCalled();
    });
});
