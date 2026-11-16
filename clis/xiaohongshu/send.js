import { cli, Strategy } from '@jackwener/opencli/registry';
import { WRITE_ARGS, WRITE_COLUMNS, parseWriteOptions, runApprovedWrite } from '../_shared/social-write.js';
import { evaluateWrite, preparePrivateWrite, validateSendArgs } from './write-im.js';

export const command = cli({
    site: 'xiaohongshu', name: 'send', access: 'write', description: '预检查或审批后发送普通用户私信；新对象通过原生聊天准备，未知结果不重试',
    domain: 'www.xiaohongshu.com', strategy: Strategy.COOKIE, browser: true, navigateBefore: false,
    args: [{ name: 'target', positional: true, required: true, help: 'Exact 24-character user ID or public profile URL' },
        { name: 'text', positional: true, required: true, help: 'Exact text (1-1000 characters; no boundary whitespace or CR)' }, ...WRITE_ARGS],
    columns: WRITE_COLUMNS,
    validateArgs: args => { validateSendArgs(args); parseWriteOptions(args, true); },
    func: async (page, args) => {
        validateSendArgs(args); const options = parseWriteOptions(args, true);
        const plan = await preparePrivateWrite(page, args.target, 'send', args.text);
        return runApprovedWrite({ ...args, 'request-id': options.requestId }, plan, expiresAt => evaluateWrite(page, {
            ...plan, operation: 'send', requestId: options.requestId, expiresAt,
        }));
    },
});
