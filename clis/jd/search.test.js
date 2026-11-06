import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { getRegistry } from '@jackwener/opencli/registry';
import { createPageMock } from '../test-utils.js';
import './search.js';
import { detectJdGate, jdGateError } from './page-state.js';

const LOGIN_URL = 'https://passport.jd.com/new/login.aspx?ReturnUrl=https%3A%2F%2Fsearch.jd.com%2FSearch%3Fkeyword%3D%25E8%258B%25B1%25E5%258F%2591';
const RISK_URL = 'https://cfe.m.jd.com/privatedomain/risk_handler/03101900/';
const SEARCH_URL = 'https://search.jd.com/Search?keyword=%E8%8B%B1%E5%8F%91&enc=utf-8';

const originalDocument = globalThis.document;
const originalLocation = globalThis.location;

function installDom(html, url) {
    const dom = new JSDOM(html, { url });
    globalThis.document = dom.window.document;
    globalThis.location = dom.window.location;
}

function restoreDom() {
    globalThis.document = originalDocument;
    globalThis.location = originalLocation;
}

// Runs the adapter's real in-page script against the installed JSDOM, with
// fake timers so the selector poll does not cost real seconds.
function createDomPage() {
    return createPageMock([], {
        evaluate: vi.fn(async (script) => {
            const pending = (0, eval)(script);
            await vi.advanceTimersByTimeAsync(15_000);
            return pending;
        }),
    });
}

describe('jd page-state gate detection', () => {
    afterEach(restoreDom);

    it('flags the passport login redirect by host', () => {
        installDom('<html><head><title>京东-欢迎登录</title></head><body>请登录</body></html>', LOGIN_URL);
        expect(detectJdGate()).toMatchObject({ isLoginPage: true });
    });

    it('flags a login page served under another host by its title', () => {
        installDom('<html><head><title>京东登录</title></head><body></body></html>', SEARCH_URL);
        expect(detectJdGate()).toMatchObject({ isLoginPage: true });
    });

    it('flags a JD security verification page', () => {
        installDom('<html><head><title>京东验证</title></head><body>请完成安全验证</body></html>', RISK_URL);
        expect(detectJdGate()).toMatchObject({ isLoginPage: false, hasSecurityChallenge: true });
    });

    it('does not flag an ordinary search page with no products', () => {
        installDom('<html><head><title>英发 - 商品搜索 - 京东</title></head><body>抱歉，没有找到相关的商品 你好，请登录 免费注册</body></html>', SEARCH_URL);
        expect(detectJdGate()).toMatchObject({ isLoginPage: false, hasSecurityChallenge: false });
    });

    it('maps gates to typed errors and leaves clean pages alone', () => {
        expect(jdGateError({ isLoginPage: true, href: LOGIN_URL }, 'JD search')).toMatchObject({
            code: 'AUTH_REQUIRED',
            message: 'JD search was redirected to the JD login page (passport.jd.com/new/login.aspx)',
        });
        expect(jdGateError({ hasSecurityChallenge: true, href: RISK_URL }, 'JD search')).toMatchObject({ code: 'SECURITY_BLOCK' });
        expect(jdGateError({ isLoginPage: false, hasSecurityChallenge: false }, 'JD search')).toBeNull();
        expect(jdGateError(undefined, 'JD search')).toBeNull();
    });
});

describe('jd search command', () => {
    const command = getRegistry().get('jd/search');

    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        restoreDom();
    });

    it('throws AUTH_REQUIRED instead of returning [] when search redirects to passport login', async () => {
        installDom('<html><head><title>京东-欢迎登录</title></head><body>请登录</body></html>', LOGIN_URL);
        const page = createDomPage();
        await expect(command.func(page, { query: '英发游泳板', limit: 5 })).rejects.toMatchObject({
            code: 'AUTH_REQUIRED',
            message: expect.stringContaining('passport.jd.com/new/login.aspx'),
        });
    });

    it('throws SECURITY_BLOCK when JD shows a verification page instead of results', async () => {
        installDom('<html><head><title>京东验证</title></head><body>请完成安全验证</body></html>', RISK_URL);
        const page = createDomPage();
        await expect(command.func(page, { query: '英发游泳板', limit: 5 })).rejects.toMatchObject({
            code: 'SECURITY_BLOCK',
        });
    });

    it('still returns [] for a genuine zero-result search page', async () => {
        installDom('<html><head><title>英发 - 商品搜索 - 京东</title></head><body>抱歉，没有找到相关的商品 你好，请登录</body></html>', SEARCH_URL);
        const page = createDomPage();
        await expect(command.func(page, { query: '英发游泳板', limit: 5 })).resolves.toEqual([]);
    });

    it('extracts product rows from a populated results page', async () => {
        installDom(`<html><head><title>英发 - 商品搜索 - 京东</title></head><body>
            <a>你好，请登录</a>
            <div data-sku="100226966445">英发 A型 游泳浮板 成人儿童 ¥53.10 英发京东自营旗舰店</div>
            <div data-sku="10161519329190">英发 游泳板 打水板 初学者 ¥39.90 英发官方旗舰店</div>
        </body></html>`, SEARCH_URL);
        const page = createDomPage();
        const rows = await command.func(page, { query: '英发游泳板', limit: 5 });
        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({
            rank: 1,
            price: '¥53.10',
            sku: '100226966445',
            url: 'https://item.jd.com/100226966445.html',
        });
    });

    it('rejects a malformed page payload with a typed error', async () => {
        const page = createPageMock([null]);
        await expect(command.func(page, { query: '英发游泳板', limit: 5 })).rejects.toMatchObject({
            code: 'COMMAND_EXEC',
        });
    });
});
