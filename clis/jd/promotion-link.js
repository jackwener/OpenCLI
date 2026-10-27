import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, TimeoutError } from '@jackwener/opencli/errors';
import { normalizeNumericId } from '../_shared/common.js';

const PROMOTION_PAGE = 'https://union.jd.com/proManager/custompromotion';

/** 校验全部参数，避免打开浏览器后才发现网站或推广位未指定。 */
export function normalizePromotionArgs(args) {
    const sku = normalizeNumericId(args.sku, 'sku', '100291143898');
    const website = String(args.website ?? '').trim();
    const position = String(args.position ?? '').trim();
    const timeout = Number(args.timeout ?? 30);
    if (!website || !position) throw new ArgumentError('请用 --website 和 --position 指定已有网站及推广位的完整名称');
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 120) {
        throw new ArgumentError('timeout 必须为 1 到 120 的整数秒');
    }
    const normalized = { sku, website, position, timeout };
    return normalized;
}

/** 仅接受结果表单实际返回的 HTTPS 联盟长链，不将商品页或短链当作成功。 */
export function requireLongPromotionUrl(value) {
    let parsed;
    try { parsed = new URL(value); } catch { /* 统一抛出业务错误。 */ }
    if (!parsed || parsed.protocol !== 'https:' || parsed.hostname !== 'union-click.jd.com' || parsed.pathname === '/'
        || parsed.username || parsed.password || (parsed.port && parsed.port !== '443')) {
        throw new CommandExecutionError('京东未返回有效的 HTTPS 联盟推广长链接');
    }
    return value;
}

/** 在真实可见表单中操作；不读取 Vue 私有状态、签名或账号凭据。 */
export function promotionDom(action, value) {
    const text = (el) => (el?.textContent ?? '').trim();
    // 检查全部祖先，避免读取被隐藏父容器包裹的旧结果。
    const visible = (el) => {
        if (!el) return false;
        for (let current = el; current; current = current.parentElement) {
            const style = getComputedStyle(current);
            if (current.hidden || style.display === 'none' || style.visibility === 'hidden') return false;
        }
        return true;
    };
    const tab = document.querySelector('#tab-customlink');
    const pane = document.querySelector('#pane-customlink');
    const messages = [...document.querySelectorAll('.el-message, .el-alert--error, .el-notification')]
        .filter(el => visible(el) && (el.matches('.el-message--error, .el-alert--error, .el-notification--error')
            || /访问频繁|操作频繁|请求频繁|稍后再试/.test(text(el)))).map(text);
    const bodyText = document.body?.innerText ?? '';
    if (/passport\.jd\.com|\/login(?:[/?#]|$)|\/user(?:[/?#]|$)/.test(location.href)
        || /请先登录|请登录京东|扫码登录|安全验证|滑动验证/.test(bodyText)) return { auth: true };
    if (messages.length) return { error: messages.join('；') };

    const allDialogs = [...document.querySelectorAll('[role="dialog"][aria-label="生成推广链接"]')];
    const visibleDialogs = allDialogs.filter(visible);
    if (visibleDialogs.length > 1) return { error: '发现多个可见推广结果，无法确认本次生成的结果' };
    const dialog = visibleDialogs[0];
    // 提交前拒绝可见旧结果；点击瞬间再检查一次，避免检查与提交之间出现旧弹窗。
    if (action === 'baseline' || action === 'generate') {
        if (dialog) return { error: '页面已有推广结果，请关闭旧弹窗并刷新页面后再运行命令' };
        if (action === 'baseline') return { done: true };
    }
    /** 在点击与读取结果时核对公开表单，人工编辑或异步重置不能造成目标错配。 */
    const selectedInput = label => [...(pane?.querySelectorAll('.el-form-item') ?? [])]
        .find(el => text(el.querySelector('.el-form-item__label')) === label)?.querySelector('.el-select input');
    if (action === 'generate' && !value?.expectedSource) return { error: '未提供本次转链表单的预期值' };
    if (value?.expectedSource) {
        const websiteInput = selectedInput('所属网站');
        const positionInput = selectedInput('推广位名称');
        const existingPosition = [...(pane?.querySelectorAll('.el-form-item') ?? [])]
            .find(el => text(el.querySelector('.el-form-item__label')) === '投放推广位')?.querySelector('input[value="0"]');
        if (!visible(pane) || !pane.querySelector('input[value="webPromotion"]')?.checked
            || !existingPosition?.checked
            || pane.querySelector('textarea')?.value !== value.expectedSource
            || !visible(websiteInput) || websiteInput.value !== value.expectedWebsite
            || !visible(positionInput) || positionInput.value !== value.expectedPosition) {
            return { error: '京东联盟表单与本次商品、网站或推广位不一致，请核对后重新运行' };
        }
    }

    /** 基线包含隐藏弹窗内的旧商品长链；不能仅凭旧节点再次显示或复制就认定生成成功。 */
    const productValues = candidate => {
        const candidateTab = [...candidate.querySelectorAll('[role="tab"]')].find(el => text(el) === '长链接');
        const candidatePane = [...candidate.querySelectorAll('[role="tabpanel"]')]
            .find(el => el.getAttribute('aria-labelledby') === candidateTab?.id);
        return [...(candidatePane?.querySelectorAll('.el-row') ?? [])]
            .filter(el => [...el.querySelectorAll('span')].some(label => text(label) === '商品链接'))
            .map(el => el.querySelector('input, textarea')?.value).filter(Boolean);
    };
    // 只读取当前可见的结果弹窗，优惠券链接不能冒充商品长链。
    const longTab = dialog && [...dialog.querySelectorAll('[role="tab"]')].find(el => text(el) === '长链接');
    if (action === 'long-tab') {
        if (!longTab) return { error: '结果弹窗未提供长链接' };
        longTab.click();
        return { done: true };
    }
    let linkValue = null;
    if (longTab?.getAttribute('aria-selected') === 'true') {
        const resultPane = [...dialog.querySelectorAll('[role="tabpanel"]')]
            .find(el => el.getAttribute('aria-labelledby') === longTab.id && visible(el));
        const productRow = resultPane && [...resultPane.querySelectorAll('.el-row')]
            .find(el => visible(el) && [...el.querySelectorAll('span')].some(label => text(label) === '商品链接'));
        linkValue = productRow?.querySelector('input, textarea')?.value ?? null;
    }
    if (action === 'state') return { ready: visible(pane), hasResult: !!dialog, hasLongTab: !!longTab, linkValue };

    if (action === 'activate') {
        if (!visible(tab)) return { waiting: true };
        if (tab.getAttribute('aria-selected') !== 'true') tab.click();
        return { done: true };
    }
    if (!visible(pane)) return { waiting: true };
    if (action === 'website-mode') {
        const radio = pane.querySelector('input[value="webPromotion"]');
        if (!radio) return { error: '网站推广选项不存在，页面结构可能已改变' };
        if (!radio.checked) radio.closest('label').click();
        return { done: true };
    }
    if (action === 'generate') {
        const button = [...pane.querySelectorAll('button')].find(el => text(el) === '获取推广链接');
        if (!button || button.disabled) return { error: '生成按钮不可用，请核对网站及推广位权限' };
        const priorResultValues = allDialogs.flatMap(productValues);
        button.click();
        return { done: true, priorResultValues };
    }

    const field = [...pane.querySelectorAll('.el-form-item')]
        .find(el => text(el.querySelector('.el-form-item__label')) === value.label);
    const input = field?.querySelector('.el-select input');
    if (action === 'field-ready') return { ready: !!input && visible(input) };
    if (!input) return { error: `未找到${value.label}选择框，页面结构可能已改变` };
    if (action === 'selected') return { selected: input.value === value.name };
    if (action === 'open-select') {
        input.click();
        return { done: true };
    }
    // 下拉框属于当前字段；另一个字段的关闭动画不能提前结束本字段的等待。
    const dropdown = field.querySelector('.el-select-dropdown');
    const options = dropdown ? [...dropdown.querySelectorAll('.el-select-dropdown__item')].filter(visible) : [];
    // 京东请求尚未返回时也会显示“无数据”；仅等到真实选项出现，不能把暂时空列表当作完成。
    if (action === 'options') return { loaded: options.length > 0 };
    const matches = options.filter(el => text(el) === value.name);
    if (matches.length !== 1) return { argument: `${value.label}“${value.name}”${matches.length ? '存在多个同名项，请使用唯一名称' : '不存在或当前账号无权使用'}` };
    if (matches[0].classList.contains('is-disabled')) return { argument: `${value.label}“${value.name}”不可用` };
    matches[0].click();
    return { done: true };
}

/** DOM 的业务失败采用稳定错误类型；不返回空字符串或伪成功结果。 */
function checkState(state) {
    if (!state || typeof state !== 'object') throw new CommandExecutionError('无法读取京东联盟页面状态');
    if (state.auth) throw new AuthRequiredError('union.jd.com', '请在 Chrome 登录已开通推广功能的京东联盟账号，并完成必要验证');
    if (state.argument) throw new ArgumentError(state.argument);
    if (state.error) throw new CommandExecutionError(state.error);
    return state;
}

cli({
    site: 'jd',
    name: 'promotion-link',
    description: '使用已登录京东联盟的网站及推广位生成商品推广长链接',
    domain: 'union.jd.com',
    strategy: Strategy.UI,
    access: 'write',
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'sku', positional: true, required: true, help: '京东商品 SKU ID' },
        { name: 'website', required: true, help: '已有网站媒体的完整名称（所属网站）' },
        { name: 'position', required: true, help: '该网站下已有推广位的完整名称（推广位名称）' },
        { name: 'timeout', type: 'int', default: 30, help: '等待页面和转链结果的总秒数（1–120）' },
    ],
    columns: ['sku', 'website', 'position', 'sourceUrl', 'promotionUrl'],
    validateArgs: normalizePromotionArgs,
    /** 复用浏览器登录态，通过公开表单完成一次转链并核验结果。 */
    func: async (page, args) => {
        const { sku, website, position, timeout } = normalizePromotionArgs(args);
        const sourceUrl = `https://item.jd.com/${sku}.html`;
        const deadline = Date.now() + timeout * 1000;
        /** 每次 DOM 操作后先识别认证及业务错误，再继续下一步。 */
        const run = async (action, value = null) => checkState(await page.evaluate(
            `(${promotionDom.toString()})(${JSON.stringify(action)}, ${JSON.stringify(value)})`,
        ));
        /** 共享总截止时间；京东拒绝请求时立即退出，不自动重试生成。 */
        const until = async (action, predicate, value = null) => {
            while (Date.now() < deadline) {
                const state = await run(action, value);
                if (predicate(state)) return state;
                await page.wait({ time: 0.25 });
            }
            throw new TimeoutError('京东联盟转链', timeout);
        };
        /** 仅选择一个现有命名项，随后核对选择框确实反映了目标名称。 */
        const selectExisting = async (label, name) => {
            const value = { label, name };
            // 选定网站后，京东异步加载并挂载该网站的推广位选择框。
            await until('field-ready', state => state.ready, value);
            await run('open-select', value);
            await until('options', state => state.loaded, value);
            await run('select', value);
            await until('selected', state => state.selected, value);
        };

        await page.goto(PROMOTION_PAGE);
        await run('baseline');
        await until('activate', state => state.done);
        await until('state', state => state.ready);
        await run('website-mode');
        const filled = await page.fillText('#pane-customlink textarea', sourceUrl);
        if (!filled?.verified) throw new CommandExecutionError('京东商品链接未正确写入转链表单');
        await selectExisting('所属网站', website);
        await selectExisting('推广位名称', position);
        const expected = { expectedSource: sourceUrl, expectedWebsite: website, expectedPosition: position };
        // 在同一次页面执行中核对表单、记录旧结果基线并点击一次，避免检查与点击之间的异步竞态。
        const submitted = await run('generate', expected);
        const result = await until('state', state => state.hasResult, expected);
        if (!result.hasLongTab) throw new CommandExecutionError('京东仅返回了短链或其他推广形式，未返回长链接');
        await run('long-tab', expected);
        // 同值旧链接无法证明属于本次请求；继续等待实际更新，超时后停止而不重新提交。
        const selected = await until('state', state => !!state.linkValue
            && !submitted.priorResultValues.includes(state.linkValue), expected);
        const promotionUrl = requireLongPromotionUrl(selected.linkValue);
        return [{ sku, website, position, sourceUrl, promotionUrl }];
    },
});
