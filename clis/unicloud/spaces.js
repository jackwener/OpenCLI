import { cli, Strategy } from '@jackwener/opencli/registry';
import { loadSpaces } from './utils.js';

cli({
    site: 'unicloud', name: 'spaces', description: '列出 uniCloud 服务空间、免费续期条件和到期时间',
    domain: 'unicloud.dcloud.net.cn', strategy: Strategy.UI, browser: true, access: 'read',
    navigateBefore: false, args: [],
    columns: ['space_id', 'name', 'provider', 'plan', 'expires_at', 'days_remaining', 'status', 'renewable'],
    // 仅读取已登录控制台，不保存认证信息。
    func: async (page) => loadSpaces(page),
});
