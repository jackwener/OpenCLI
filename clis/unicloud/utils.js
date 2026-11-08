import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError, TimeoutError } from '@jackwener/opencli/errors';

export const CONSOLE_URL = 'https://unicloud.dcloud.net.cn/';
const ORDER_PATH = '/uni_modules/uni-trade/pages/create-order/create-order';
const PACKAGES = { aliyun: 'free', alipay: 'public_cloudd_cd_cn_free_bag' };

/** 按中国标准时间解析平台日期，拒绝不存在的日期。 */
export function parseExpiry(value) {
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value ?? '')) {
        throw new CommandExecutionError('无法识别服务空间到期时间');
    }
    const stamp = Date.parse(value.replace(' ', 'T') + '+08:00');
    if (!Number.isFinite(stamp) || new Date(stamp + 8 * 3600000).toISOString().slice(0, 19).replace('T', ' ') !== value) {
        throw new CommandExecutionError('服务空间到期时间无效');
    }
    return stamp;
}

/** 在进入浏览器前检查所有用户参数，避免错误参数产生副作用。 */
export function validateRenewArgs(args) {
    if (typeof args.space !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9-]{2,127}$/.test(args.space)) {
        throw new ArgumentError('space 必须是完整的服务空间 SpaceID');
    }
    const days = Number(args['within-days'] ?? 7);
    if (!Number.isInteger(days) || days < 0 || days > 30) throw new ArgumentError('within-days 必须是 0 到 30 的整数');
    if (args.confirm !== undefined && typeof args.confirm !== 'boolean') throw new ArgumentError('confirm 必须是布尔值');
    return { days, confirm: args.confirm === true };
}

/** 从用户可见表格提取数据；独立函数可在真实页面和脱敏 DOM 测试中运行。 */
export function readSpacesDOM() {
    const text = e => (e?.innerText ?? e?.textContent ?? '').trim();
    const visible = e => {
        for (let p = e; p; p = p.parentElement) {
            const s = getComputedStyle(p);
            if (p.hidden || s.display === 'none' || s.visibility === 'hidden') return false;
        }
        return true;
    };
    if (/\/login(?:\/|$)/.test(location.pathname) || /请先登录|扫码登录|登录已过期/.test(text(document.body))) return { auth: false };
    const tables = [...document.querySelectorAll('table')].filter(visible).filter(t => {
        const h = [...t.querySelectorAll('tr:first-child th,tr:first-child td')].map(text);
        return ['服务空间', 'SpaceID', '云服务商', '付费方式', '状态'].every(k => h.includes(k));
    });
    if (tables.length !== 1) return { auth: true, ready: false };
    const head = [...tables[0].querySelectorAll('tr:first-child th,tr:first-child td')].map(text);
    const entries = [...tables[0].querySelectorAll('tr')].slice(1).filter(visible).map(tr => {
        const cells = [...tr.querySelectorAll('td')];
        const cell = key => cells[head.indexOf(key)];
        const billing = text(cell('付费方式'));
        const id = text(cell('SpaceID')).match(/(?:mp|env)-[A-Za-z0-9-]+/)?.[0];
        const expiry = billing.match(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\s*到期/)?.[1];
        return {
            rawId: id ?? null, rawName: text(cell('服务空间')), rawProvider: text(cell('云服务商')),
            rawPlan: billing.split(/\d{4}-\d{2}-\d{2}/)[0].trim(), rawExpiry: expiry ?? null,
            rawStatus: text(cell('状态')),
        };
    });
    return { auth: true, ready: true, entries };
}

/** 有界等待列表加载；登录、结构错误、空列表使用不同错误类型。 */
export async function loadSpaces(page, navigate = true) {
    if (navigate) await page.goto(CONSOLE_URL);
    let lastState;
    for (let i = 0; i < 20; i++) {
        const state = await page.evaluate(`(${readSpacesDOM.toString()})()`);
        lastState = state;
        if (!state?.auth) throw new AuthRequiredError('unicloud.dcloud.net.cn', '请先在浏览器登录 uniCloud');
        if (state.ready && state.entries.length && state.entries.every(raw => raw.rawId && raw.rawName)) {
            return state.entries.map(raw => {
                if (!raw.rawId || !raw.rawName) throw new CommandExecutionError('服务空间表格缺少名称或 SpaceID');
                const provider = { 阿里云: 'aliyun', 支付宝云: 'alipay' }[raw.rawProvider] ?? raw.rawProvider;
                const expires_at = raw.rawExpiry;
                if (expires_at !== null) parseExpiry(expires_at);
                return {
                    space_id: raw.rawId, name: raw.rawName, provider, plan: raw.rawPlan, expires_at,
                    days_remaining: expires_at === null ? null : Math.ceil((parseExpiry(expires_at) - Date.now()) / 86400000),
                    status: raw.rawStatus,
                    renewable: ({ aliyun: '免费套餐（开发者版）', alipay: '包月套餐（免费版）' })[provider] === raw.rawPlan && expires_at !== null && raw.rawStatus === '正常',
                };
            });
        }
        await page.wait({ time: 0.5 });
    }
    if (lastState?.ready) {
        if (!lastState.entries.length) throw new EmptyResultError('unicloud spaces', '当前账号没有服务空间');
        throw new CommandExecutionError('服务空间表格缺少名称或 SpaceID');
    }
    throw new TimeoutError('uniCloud 服务空间列表', 10);
}

/** 精确匹配 SpaceID，禁止同名或重复行导致续费对象漂移。 */
export function selectSpace(rows, id) {
    const matches = rows.filter(row => row.space_id === id);
    if (!matches.length) throw new EmptyResultError('unicloud renew', '未找到指定 SpaceID');
    if (matches.length !== 1) throw new CommandExecutionError('SpaceID 存在重复行，已停止');
    return matches[0];
}

/** 使用实际观察到的官方续费页面路由，限定两个已验证的免费套餐。 */
export function orderUrl(space) {
    if (!space.renewable || !PACKAGES[space.provider]) throw new CommandExecutionError('仅支持状态正常的阿里云或支付宝云免费套餐续期');
    const query = new URLSearchParams({ buy_type: '2', provider: space.provider, space_id: space.space_id,
        package_id: PACKAGES[space.provider], name: space.name, pay_mode: '1', end_at: space.expires_at });
    return `https://uni-trade.dcloud.net.cn${ORDER_PATH}?${query}`;
}

/** 读取并校验真实订单；提交时在同一同步任务内再次校验并单击，防止报价变更。 */
export function inspectOrderDOM(expected, submit = false) {
    const text = e => (e?.innerText ?? e?.textContent ?? '').trim();
    const visible = e => {
        for (let p = e; p; p = p.parentElement) {
            const s = getComputedStyle(p);
            if (p.hidden || s.display === 'none' || s.visibility === 'hidden') return false;
        }
        return true;
    };
    const body = text(document.body);
    if (/\/login(?:\/|$)/.test(location.pathname) || /请先登录|扫码登录|登录已过期/.test(body)) return { kind: 'auth' };
    const url = new URL(location.href);
    const target = new URL(expected.url);
    if (url.origin !== target.origin || url.pathname !== target.pathname || [...target.searchParams].some(([k, v]) => url.searchParams.getAll(k).length !== 1 || url.searchParams.get(k) !== v)) return { kind: 'unsafe', reason: '续费页面目标不一致' };
    const titles = [...document.querySelectorAll('.title')].filter(visible);
    const prices = [...document.querySelectorAll('.footer-box .price-inner')].filter(visible);
    const groups = [...document.querySelectorAll('.uni-trade-item')].filter(visible);
    const group = label => groups.filter(e => text(e.querySelector('.uni-trade-item__label')) === label);
    const provider = group('服务商');
    const names = group('服务空间名称');
    const durations = group('购买时长');
    const plans = group('套餐版本');
    const buttons = [...document.querySelectorAll('.create-button-group uni-button,.create-button-group button')].filter(visible).filter(e => text(e) === '立即购买');
    if (!titles.length || !prices.length || !groups.length || !buttons.length) return { kind: 'loading' };
    const priceNodes = prices.flatMap(e => [...e.querySelectorAll('.market-price')].filter(visible));
    const nameInputs = names.flatMap(e => [...e.querySelectorAll('input')].filter(visible));
    const selected = durations.flatMap(e => [...e.querySelectorAll('.select-box-item.active')].filter(visible));
    const planRows = plans.flatMap(e => [...e.querySelectorAll('tr')].slice(1).filter(visible));
    // Vue 先渲染表单外壳，再填充套餐和名称；缺失字段只等待，已有但不匹配的字段立即拒绝。
    if (!provider.length || !names.length || !durations.length || !plans.length || !nameInputs.length || !nameInputs[0].value.trim() || !text(provider[0].querySelector('.uni-trade-item__content')) || !priceNodes.length || !text(priceNodes[0]) || !selected.length || !planRows.length) return { kind: 'loading' };
    const providerName = { aliyun: '阿里云', alipay: '支付宝云' }[expected.provider];
    const planName = { aliyun: '开发者版', alipay: '免费版' }[expected.provider];
    const planCells = planRows.length === 1 ? [...planRows[0].querySelectorAll('td')].map(text) : [];
    if (titles.length !== 1 || text(titles[0]) !== `服务空间续费（${expected.name}）` || provider.length !== 1 || text(provider[0].querySelector('.uni-trade-item__content')) !== providerName || nameInputs.length !== 1 || nameInputs[0].value !== expected.name || !nameInputs[0].disabled) return { kind: 'unsafe', reason: '续费空间名称或服务商不一致' };
    if (prices.length !== 1 || priceNodes.length !== 1 || text(prices[0].querySelector('.price-text')) !== '费用' || !/^0(?:\.0{1,2})?元$/.test(text(priceNodes[0])) || selected.length !== 1 || text(selected[0]) !== '1个月' || planRows.length !== 1 || !planCells.includes(planName) || planCells.at(-1) !== '免费') return { kind: 'unsafe', reason: '订单未明确显示免费套餐、1个月和0元总价' };
    if (buttons.length !== 1 || buttons[0].hasAttribute('disabled') || buttons[0].getAttribute('aria-disabled') === 'true' || buttons[0].classList.contains('uni-button-disabled')) return { kind: 'unsafe', reason: '续费按钮不可用或不唯一' };
    // 平台可能要求关注公众号或显示限制弹窗；不自动接受额外条件。
    if ([...document.querySelectorAll('.uni-popup,.uni-modal,[role="dialog"]')].filter(visible).length) return { kind: 'unsafe', reason: '页面存在待处理弹窗，请人工检查' };
    const notices = [...document.querySelectorAll('.bottom-info')].filter(visible).map(text).join('\n') || null;
    if (submit) buttons[0].click();
    return { kind: submit ? 'submitted' : 'ready', notices };
}

/** 预览阶段只读轮询；价格或对象不符立即失败，避免盲目重试。 */
export async function loadOrder(page, expected) {
    await page.goto(expected.url);
    for (let i = 0; i < 20; i++) {
        const result = await page.evaluate(`(${inspectOrderDOM.toString()})(${JSON.stringify(expected)})`);
        checkOrder(result);
        if (result.kind === 'ready') return result;
        await page.wait({ time: 0.5 });
    }
    throw new TimeoutError('uniCloud 免费续费订单', 10);
}

/** 将页面判定转成稳定的命令错误，输出中不包含会话或支付链接。 */
export function checkOrder(result) {
    if (result?.kind === 'auth') throw new AuthRequiredError('uni-trade.dcloud.net.cn', '请先在浏览器登录 DCloud 订单中心');
    if (result?.kind === 'unsafe') throw new CommandExecutionError(result.reason);
    if (!['loading', 'ready', 'submitted'].includes(result?.kind)) throw new CommandExecutionError('无法识别续费页面状态');
}

/**
 * 核验平台支付页的可见金额及 Vue 已加载订单。
 * 订单页 UI 不展示 SpaceID，因此同时校验官方页面 hydration 中的 expand_info；不调用内部接口。
 */
export function inspectPaymentDOM(expected, submit = false) {
    const text = e => (e?.innerText ?? e?.textContent ?? '').trim();
    const visible = e => {
        for (let p = e; p; p = p.parentElement) {
            const s = getComputedStyle(p);
            if (p.hidden || s.display === 'none' || s.visibility === 'hidden') return false;
        }
        return true;
    };
    if (/\/login(?:\/|$)/.test(location.pathname)) return { kind: 'auth' };
    if (location.origin !== 'https://uni-trade.dcloud.net.cn') return { kind: 'unsafe', reason: '订单确认页来源不一致' };
    if (location.pathname !== '/uni_modules/uni-trade/pages/order-payment/order-payment') return { kind: 'loading' };
    const ids = new URL(location.href).searchParams.getAll('order_id');
    if (ids.length !== 1 || !/^[A-Za-z0-9_-]+$/.test(ids[0])) return { kind: 'unsafe', reason: '订单编号缺失或不唯一' };
    if (expected.orderId && expected.orderId !== ids[0]) return { kind: 'unsafe', reason: '确认期间订单编号变化' };
    const roots = [...document.querySelectorAll('.pc-pay')].filter(visible);
    if (roots.length !== 1) return { kind: 'loading' };
    let component = roots[0].__vueParentComponent;
    let vm;
    for (let i = 0; component && i < 30; i++, component = component.parent) {
        if (component.proxy?.orderInfo && component.proxy?.uniPay) { vm = component.proxy; break; }
    }
    if (!vm?.complete || vm.uniPay.loading) return { kind: 'loading' };
    const info = vm.orderInfo;
    const details = info.expand_info;
    const packageId = { aliyun: 'free', alipay: 'public_cloudd_cd_cn_free_bag' }[expected.provider];
    const productCode = { aliyun: 'ali_cloud_space', alipay: 'alipay_cloud_space' }[expected.provider];
    const zero = value => value === 0 || value === '0.00';
    if (vm.uniPay.order_id !== ids[0] || details?.buyType !== 2 || details.businessType !== 1 || details.spaceId !== expected.space_id || details.spaceName !== expected.name || details.provider !== expected.provider || details.duration !== 1 || info.product_code !== productCode || info.skuInfo?.version?.value !== packageId || !zero(info.real_amount) || !zero(info.total_amount)) return { kind: 'unsafe', reason: '订单数据与免费空间续期不一致' };
    const amounts = [...roots[0].querySelectorAll('.pc-pay-order-detial-code-info-subtitle')].filter(visible);
    const types = [...roots[0].querySelectorAll('.pc-pay-order-detial-content .content-item-latest')].filter(visible);
    const buttons = [...roots[0].querySelectorAll('uni-button.order-btn,button.order-btn')].filter(visible);
    if (amounts.length !== 1 || !/^0(?:\.0{1,2})?元$/.test(text(amounts[0])) || types.length !== 1 || text(types[0]) !== '服务空间续费' || buttons.length !== 1 || text(buttons[0]) !== '确认开通' || buttons[0].hasAttribute('disabled') || buttons[0].getAttribute('aria-disabled') === 'true' || buttons[0].classList.contains('uni-button-disabled')) return { kind: 'unsafe', reason: '确认页未明确显示0元服务空间续费' };
    if ([...document.querySelectorAll('.uni-popup,.uni-modal,[role="dialog"]')].filter(visible).length) return { kind: 'unsafe', reason: '确认页存在待处理弹窗' };
    if (submit) buttons[0].click();
    return { kind: submit ? 'submitted' : 'ready', orderId: ids[0] };
}

/** 创建订单后只等待新订单页面；免费确认只发送一次，不调用付费支付方式。 */
export async function confirmFreeOrder(page, expected) {
    for (let i = 0; i < 30; i++) {
        const state = await page.evaluate(`(${inspectPaymentDOM.toString()})(${JSON.stringify(expected)})`);
        checkOrder(state);
        if (state.kind === 'ready') {
            const bound = { ...expected, orderId: state.orderId };
            const result = await page.evaluateOnce(`(${inspectPaymentDOM.toString()})(${JSON.stringify(bound)}, true)`);
            checkOrder(result);
            if (result.kind !== 'submitted') throw new CommandExecutionError('免费订单尚未确认；请检查订单中心，勿直接重试');
            return;
        }
        await page.wait({ time: 0.5 });
    }
    throw new CommandExecutionError('未能确认新订单页面；请检查订单中心，勿直接重试续费');
}
