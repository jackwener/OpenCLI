import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { checkOrder, confirmFreeOrder, inspectOrderDOM, loadOrder, loadSpaces, orderUrl, parseExpiry, selectSpace, validateRenewArgs } from './utils.js';

cli({
    site: 'unicloud', name: 'renew', description: '预览或确认 uniCloud 免费空间续期，按到期窗口安全跳过',
    domain: 'unicloud.dcloud.net.cn', strategy: Strategy.UI, browser: true, access: 'write',
    navigateBefore: false, siteSession: 'persistent', validateArgs: validateRenewArgs,
    args: [
        { name: 'space', positional: true, required: true, help: '完整 SpaceID；使用 spaces 命令查询' },
        { name: 'within-days', type: 'int', default: 7, help: '仅在到期前多少天内续期，0到30，默认7' },
        { name: 'confirm', type: 'bool', default: false, help: '确认执行0元续期；不传时只预览' },
    ],
    columns: ['space_id', 'name', 'provider', 'status', 'previous_expires_at', 'expires_at', 'amount', 'months', 'notices'],
    /** 默认预览；提交只执行一次，只有到期时间延长才返回已续期。 */
    func: async (page, args) => {
        const { days, confirm } = validateRenewArgs(args);
        const space = selectSpace(await loadSpaces(page), args.space);
        const url = orderUrl(space);
        const result = (status, expiry, notices = null) => [{
            space_id: space.space_id, name: space.name, provider: space.provider, status,
            previous_expires_at: space.expires_at, expires_at: expiry, amount: 0, months: 1, notices,
        }];
        if (parseExpiry(space.expires_at) - Date.now() > days * 86400000) return result('skipped', space.expires_at);
        const expected = { url, name: space.name, provider: space.provider };
        const quote = await loadOrder(page, expected);
        if (!confirm) return result('preview', space.expires_at, quote.notices);
        if (typeof page.evaluateOnce !== 'function') throw new CommandExecutionError('当前浏览器不支持单次提交，请更新 OpenCLI；未执行续费');
        // evaluateOnce 禁止导航错误后的脚本重放，避免重复创建订单。
        try {
            const submitted = await page.evaluateOnce(`(${inspectOrderDOM.toString()})(${JSON.stringify(expected)}, true)`);
            checkOrder(submitted);
            if (submitted.kind !== 'submitted') throw new CommandExecutionError('提交时订单未就绪；未执行续费');
        } catch (error) {
            throw new CommandExecutionError('续费提交未确认，请先运行 unicloud spaces 核对到期时间，勿直接重试', error?.code === 'COMMAND_EXEC' ? error.message : undefined);
        }
        // 平台先创建订单，再进入订单确认页；必须完成0元确认才算续期。
        try {
            await confirmFreeOrder(page, { space_id: space.space_id, name: space.name, provider: space.provider });
        } catch (error) {
            throw new CommandExecutionError('免费订单确认未完成，请先核对订单中心与到期时间，勿直接重试续费', error?.code === 'COMMAND_EXEC' ? error.message : undefined);
        }
        // 平台完成订单后才会延长控制台到期时间，轮询只读页面，不重复提交。
        for (let i = 0; i < 5; i++) {
            await page.wait({ time: 2 });
            const current = selectSpace(await loadSpaces(page), space.space_id);
            if (current.name !== space.name || current.provider !== space.provider || current.plan !== space.plan) throw new CommandExecutionError('续费后空间属性变化，请人工核对；勿直接重试');
            if (current.expires_at && parseExpiry(current.expires_at) > parseExpiry(space.expires_at)) return result('renewed', current.expires_at, quote.notices);
        }
        throw new CommandExecutionError('尚未确认到期时间延长，续费结果未知；请核对订单中心和 unicloud spaces，勿直接重试');
    },
});
