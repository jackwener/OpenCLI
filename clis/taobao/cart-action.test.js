import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { addTaobaoCartOnce } from './cart-action.js';
import { assertTaobaoPageUsable } from './page-state.js';
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
    const page = {
        evaluate: vi.fn(async script => dom.window.eval(script)),
        evaluateOnce: vi.fn(async script => dom.window.eval(script)),
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
    it.each(['add-cart', 'detail', 'search', 'reviews'])('stops %s before scraping or clicking after a login redirect', async command => {
        const page = { goto: vi.fn(), wait: vi.fn(), autoScroll: vi.fn(), evaluateOnce: vi.fn(), evaluate: vi.fn().mockResolvedValueOnce(undefined).mockResolvedValue('login') };
        await expect(getRegistry().get(`taobao/${command}`).func(page, { id: '123', query: 'test' })).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
        expect(page.evaluate).toHaveBeenCalledTimes(2);
        expect(page.autoScroll).not.toHaveBeenCalled();
        expect(page.evaluateOnce).not.toHaveBeenCalled();
    });
});
