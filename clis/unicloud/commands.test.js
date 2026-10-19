import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { getRegistry } from '@jackwener/opencli/registry';
import { inspectOrderDOM, inspectPaymentDOM, orderUrl, parseExpiry, readSpacesDOM } from './utils.js';
import './spaces.js';
import './renew.js';

const fixture = name => readFileSync(new URL(`./__fixtures__/${name}.html`, import.meta.url), 'utf8');
const spacesHTML = fixture('spaces');
const orders = { aliyun: fixture('aliyun-order'), alipay: fixture('alipay-order') };
const demo = provider => ({
    space_id: provider === 'aliyun' ? 'mp-example-aliyun' : 'env-example-alipay',
    name: provider === 'aliyun' ? 'demo-push' : 'demo', provider, renewable: true,
    expires_at: provider === 'aliyun' ? '2026-10-25 00:00:00' : '2026-10-23 23:59:59',
});

/** 根据官方订单确认页渲染代码构造的模拟契约；尚未创建真实订单取样。 */
const paymentHTML = '<main class="pc-pay"><div class="pc-pay-order-detial-content"><div class="content-item-latest">服务空间续费</div></div><div class="pc-pay-order-detial-code-info-subtitle">0.00元</div><uni-button class="order-btn">确认开通</uni-button></main>';
function hydratePayment(dom, provider, orderId = 'test-order-1') {
    const space = demo(provider);
    dom.window.document.querySelector('.pc-pay').__vueParentComponent = { proxy: {
        complete: true, uniPay: { loading: false, order_id: orderId }, orderInfo: {
            product_code: provider === 'aliyun' ? 'ali_cloud_space' : 'alipay_cloud_space',
            skuInfo: { version: { value: provider === 'aliyun' ? 'free' : 'public_cloudd_cd_cn_free_bag' } },
            total_amount: '0.00', real_amount: '0.00',
            expand_info: { buyType: 2, businessType: 1, spaceId: space.space_id, spaceName: space.name, provider, duration: 1 },
        },
    } };
}

/** 重放脱敏真实 DOM；执行真正的浏览器函数，避免仅模拟返回值掩盖解析错误。 */
function loadDOM(html, url) {
    const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('location', dom.window.location);
    vi.stubGlobal('getComputedStyle', dom.window.getComputedStyle.bind(dom.window));
    return dom;
}

/** 模拟页面导航和单次订单提交；到期日期变化由提交事件驱动。 */
function createDOMPage({ advance = true, race = false, unknown = false, paymentRace = false } = {}) {
    let dom;
    let html = spacesHTML;
    let clicks = 0; let confirmations = 0;
    const page = {
        goto: vi.fn(async url => {
            const provider = new URL(url).searchParams.get('provider');
            dom?.window.close();
            dom = new JSDOM(provider ? orders[provider] : html, { url, runScripts: 'outside-only' });
            if (provider) dom.window.document.querySelector('.create-button-group uni-button').addEventListener('click', () => {
                clicks++;
                dom.window.document.body.innerHTML = paymentHTML;
                dom.window.history.replaceState({}, '', '/uni_modules/uni-trade/pages/order-payment/order-payment?order_id=test-order-1');
                hydratePayment(dom, provider);
                dom.window.document.querySelector('.order-btn').addEventListener('click', () => {
                    confirmations++;
                    if (advance) html = html.replaceAll('2026-10-23', '2026-11-23').replaceAll('2026-10-25', '2026-11-25');
                });
            });
        }),
        evaluate: vi.fn(async code => dom.window.eval(code)),
        evaluateOnce: vi.fn(async code => {
            if (race && code.includes('function inspectOrderDOM')) dom.window.document.querySelector('.market-price').textContent = '99元';
            if (paymentRace && code.includes('function inspectPaymentDOM')) dom.window.document.querySelector('.pc-pay').__vueParentComponent.proxy.orderInfo.real_amount = '99.00';
            const result = dom.window.eval(code);
            if (unknown) throw new Error('连接中断');
            return result;
        }),
        wait: vi.fn(async () => {}),
        get clicks() { return clicks; },
        get confirmations() { return confirmations; },
        close: () => dom?.window.close(),
    };
    return page;
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-19T10:00:00+08:00')); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('uniCloud 真实 DOM 提取', () => {
    it('按表头读取两个服务商、SpaceID 和独立到期日期', () => {
        const dom = loadDOM(spacesHTML, 'https://unicloud.dcloud.net.cn/');
        expect(readSpacesDOM()).toMatchObject({ auth: true, ready: true, entries: [
            { rawId: 'mp-example-aliyun', rawName: 'demo-push', rawProvider: '阿里云', rawExpiry: '2026-10-25 00:00:00' },
            { rawId: 'env-example-alipay', rawName: 'demo', rawProvider: '支付宝云', rawExpiry: '2026-10-23 23:59:59' },
        ] });
        dom.window.close();
    });
    it('不读取隐藏的过期表格', () => {
        const dom = loadDOM(`<div style="display:none">${spacesHTML}</div>${spacesHTML}`, 'https://unicloud.dcloud.net.cn/');
        expect(readSpacesDOM().entries).toHaveLength(2);
        dom.window.close();
    });
    it.each(['aliyun', 'alipay'])('核对 %s 的免费套餐、空间名、时长和总价', provider => {
        const space = demo(provider);
        const dom = loadDOM(orders[provider], orderUrl(space));
        expect(inspectOrderDOM({ url: orderUrl(space), ...space })).toMatchObject({ kind: 'ready' });
        dom.window.close();
    });
    it.each([
        ['非零总价', d => { d.querySelector('.market-price').textContent = '10元'; }],
        ['费用缺失', d => d.querySelector('.market-price').remove(), 'loading'],
        ['重复费用', d => d.querySelector('.price-inner').append(d.querySelector('.market-price').cloneNode(true))],
        ['重复按钮', d => d.querySelector('.create-button-group').append(d.querySelector('.create-button-group uni-button').cloneNode(true))],
        ['错误时长', d => { d.querySelector('.select-box-item.active').textContent = '12个月'; }],
        ['错误空间名', d => { d.querySelector('input').value = 'another-space'; }],
        ['可编辑空间名', d => { d.querySelector('input').disabled = false; }],
        ['按钮禁用', d => d.querySelector('.create-button-group uni-button').setAttribute('disabled', '')],
        ['付费套餐', d => { d.querySelectorAll('table td')[1].textContent = '企业版'; }],
        ['额外弹窗', d => d.body.insertAdjacentHTML('beforeend', '<div role="dialog">请关注公众号</div>')],
    ])('%s 时拒绝提交', (_label, mutate, expectedKind = 'unsafe') => {
        const space = demo('alipay');
        const expected = { ...space, url: orderUrl(space) };
        const dom = loadDOM(orders.alipay, expected.url);
        const click = vi.fn();
        dom.window.document.querySelector('.create-button-group uni-button').addEventListener('click', click);
        mutate(dom.window.document);
        expect(inspectOrderDOM(expected, true).kind).toBe(expectedKind);
        expect(click).not.toHaveBeenCalled();
        dom.window.close();
    });
    it('页面 SpaceID 不一致或存在重复参数时拒绝提交', () => {
        const space = demo('alipay');
        const expected = { ...space, url: orderUrl(space) };
        for (const url of [expected.url.replace(space.space_id, 'env-other'), expected.url + '&space_id=env-other']) {
            const dom = loadDOM(orders.alipay, url);
            expect(inspectOrderDOM(expected, true).kind).toBe('unsafe');
            dom.window.close();
        }
    });
    it.each([
        ['实付非零', vm => { vm.orderInfo.real_amount = '1.00'; }],
        ['订单总额非零', vm => { vm.orderInfo.total_amount = '1.00'; }],
        ['空间不符', vm => { vm.orderInfo.expand_info.spaceId = 'env-other'; }],
        ['服务商不符', vm => { vm.orderInfo.expand_info.provider = 'aliyun'; }],
        ['续费类型不符', vm => { vm.orderInfo.expand_info.buyType = 1; }],
        ['续费时长不符', vm => { vm.orderInfo.expand_info.duration = 12; }],
        ['套餐不符', vm => { vm.orderInfo.skuInfo.version.value = 'paid'; }],
        ['订单不符', vm => { vm.uniPay.order_id = 'another-order'; }],
    ])('免费确认页拒绝%s', (_label, mutate) => {
        const dom = loadDOM(paymentHTML, 'https://uni-trade.dcloud.net.cn/uni_modules/uni-trade/pages/order-payment/order-payment?order_id=test-order-1');
        hydratePayment(dom, 'alipay');
        const click = vi.fn(); dom.window.document.querySelector('.order-btn').addEventListener('click', click);
        mutate(dom.window.document.querySelector('.pc-pay').__vueParentComponent.proxy);
        expect(inspectPaymentDOM(demo('alipay'), true).kind).toBe('unsafe');
        expect(click).not.toHaveBeenCalled(); dom.window.close();
    });
    it('按中国时区解析日期并拒绝日期归一化', () => {
        expect(parseExpiry('2026-10-23 23:59:59')).toBe(Date.parse('2026-10-23T15:59:59Z'));
        expect(() => parseExpiry('2026-02-30 00:00:00')).toThrow();
        expect(() => parseExpiry('unknown')).toThrow();
    });
});

describe('uniCloud 续费命令的副作用边界', () => {
    const renew = () => getRegistry().get('unicloud/renew');
    it.each(['aliyun', 'alipay'])('默认只预览 %s 订单，不点击提交', async provider => {
        const page = createDOMPage();
        const rows = await renew().func(page, { space: demo(provider).space_id });
        expect(rows[0]).toMatchObject({ status: 'preview', amount: 0, months: 1 });
        expect(Object.keys(rows[0])).toEqual(renew().columns);
        expect(page.clicks).toBe(0);
        expect(page.evaluateOnce).not.toHaveBeenCalled();
        page.close();
    });
    it('提交一次并核验到期时间延长，重复执行自动跳过', async () => {
        const page = createDOMPage();
        const args = { space: demo('alipay').space_id, confirm: true };
        expect((await renew().func(page, args))[0]).toMatchObject({ status: 'renewed', expires_at: '2026-11-23 23:59:59' });
        expect((await renew().func(page, args))[0].status).toBe('skipped');
        expect(page.clicks).toBe(1);
        expect(page.evaluateOnce).toHaveBeenCalledTimes(2);
        expect(page.confirmations).toBe(1);
        page.close();
    });
    it('未进入到期窗口时不打开订单', async () => {
        const page = createDOMPage();
        expect((await renew().func(page, { space: demo('aliyun').space_id, 'within-days': 1, confirm: true }))[0].status).toBe('skipped');
        expect(page.goto).toHaveBeenCalledTimes(1);
        expect(page.clicks).toBe(0);
        page.close();
    });
    it('提交瞬间费用变化时不点击', async () => {
        const page = createDOMPage({ race: true });
        await expect(renew().func(page, { space: demo('alipay').space_id, confirm: true })).rejects.toMatchObject({ code: 'COMMAND_EXEC' });
        expect(page.clicks).toBe(0);
        page.close();
    });
    it('到期时间未变化不声称成功，且不重复提交', async () => {
        const page = createDOMPage({ advance: false });
        await expect(renew().func(page, { space: demo('alipay').space_id, confirm: true })).rejects.toThrow('结果未知');
        expect(page.clicks).toBe(1);
        expect(page.evaluateOnce).toHaveBeenCalledTimes(2);
        page.close();
    });
    it('提交返回中断时不重放写入', async () => {
        const page = createDOMPage({ unknown: true });
        await expect(renew().func(page, { space: demo('alipay').space_id, confirm: true })).rejects.toThrow('勿直接重试');
        expect(page.clicks).toBe(1);
        expect(page.evaluateOnce).toHaveBeenCalledTimes(1);
        page.close();
    });
    it('确认瞬间实付金额变化时不完成订单，不重新创建', async () => {
        const page = createDOMPage({ paymentRace: true });
        await expect(renew().func(page, { space: demo('alipay').space_id, confirm: true })).rejects.toThrow('免费订单确认未完成');
        expect(page.clicks).toBe(1); expect(page.confirmations).toBe(0);
        expect(page.evaluateOnce).toHaveBeenCalledTimes(2); page.close();
    });
    it('浏览器缺少 evaluateOnce 时拒绝执行', async () => {
        const page = createDOMPage(); delete page.evaluateOnce;
        await expect(renew().func(page, { space: demo('alipay').space_id, confirm: true })).rejects.toThrow('不支持单次提交');
        expect(page.clicks).toBe(0);
        page.close();
    });
    it.each([{ space: 'bad value' }, { space: demo('alipay').space_id, 'within-days': -1 }, { space: demo('alipay').space_id, 'within-days': 31 }, { space: demo('alipay').space_id, 'within-days': 1.5 }, { space: demo('alipay').space_id, confirm: 'true' }])('无效参数在导航前拒绝：%j', async args => {
        const page = createDOMPage();
        await expect(renew().func(page, args)).rejects.toMatchObject({ code: 'ARGUMENT' });
        expect(page.goto).not.toHaveBeenCalled();
    });
    it('等待控制台占位行和订单异步名称加载，不提前执行', async () => {
        const page = createDOMPage();
        const evaluate = page.evaluate.getMockImplementation();
        let listPending = true; let orderPending = true;
        page.evaluate.mockImplementation(async code => {
            if (code.includes('function readSpacesDOM') && listPending) {
                listPending = false;
                return { auth: true, ready: true, entries: [{ rawId: null, rawName: '暂无数据' }] };
            }
            if (code.includes('function inspectOrderDOM') && orderPending) {
                orderPending = false;
                return { kind: 'loading' };
            }
            return evaluate(code);
        });
        expect((await renew().func(page, { space: demo('alipay').space_id }))[0].status).toBe('preview');
        expect(page.clicks).toBe(0); page.close();
    });
    it('仅允许服务商对应的免费套餐', async () => {
        const page = createDOMPage();
        const evaluate = page.evaluate.getMockImplementation();
        page.evaluate.mockImplementation(async code => {
            const state = await evaluate(code);
            if (state.entries) state.entries[1].rawPlan = '免费套餐（开发者版）';
            return state;
        });
        await expect(renew().func(page, { space: demo('alipay').space_id, confirm: true })).rejects.toThrow('仅支持');
        expect(page.goto).toHaveBeenCalledTimes(1); expect(page.clicks).toBe(0); page.close();
    });
    it('未知空间不会创建订单', async () => {
        const page = createDOMPage();
        await expect(renew().func(page, { space: 'env-other', confirm: true })).rejects.toMatchObject({ code: 'EMPTY_RESULT' });
        expect(page.goto).toHaveBeenCalledTimes(1);
        expect(page.clicks).toBe(0);
        page.close();
    });
    it('识别登录页面', async () => {
        const page = createDOMPage();
        page.evaluate.mockResolvedValue({ auth: false });
        await expect(renew().func(page, { space: demo('alipay').space_id })).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
        page.close();
    });
    it('列表加载超时不会作为空成功返回', async () => {
        const page = createDOMPage();page.evaluate.mockResolvedValue({ auth: true, ready: false });
        await expect(getRegistry().get('unicloud/spaces').func(page)).rejects.toMatchObject({ code: 'TIMEOUT' });
        page.close();
    });
});
