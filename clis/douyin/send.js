import { cli, Strategy } from '@jackwener/opencli/registry';
import { WRITE_ARGS, WRITE_COLUMNS, parseWriteOptions, runApprovedWrite } from '../_shared/social-write.js';
import { evaluateWrite, parseWriteTarget, preparePrivateWrite } from './write-im.js';

export const command = cli({
    site: 'douyin', name: 'send', access: 'write', description: '预检查或审批后发送普通用户私信；支持新作者创建会话，未知结果不重试',
    domain: 'www.douyin.com', strategy: Strategy.COOKIE, browser: true, navigateBefore: false,
    args: [{ name: 'target', positional: true, required: true, help: 'Numeric UID, private conversation ID, sec_uid or exact public profile URL' },
        { name: 'text', positional: true, required: true, help: 'Exact message text (1-2000 characters)' }, ...WRITE_ARGS],
    columns: WRITE_COLUMNS,
    validateArgs: args => { parseWriteTarget(args.target); parseWriteOptions(args, true); },
    func: async (page, args) => {
        parseWriteTarget(args.target); const options = parseWriteOptions(args, true);
        const plan = await preparePrivateWrite(page, args.target, 'send', args.text);
        return runApprovedWrite({ ...args, 'request-id': options.requestId }, plan, expiresAt => evaluateWrite(page, {
            ...plan, operation: 'send', requestId: options.requestId, expiresAt,
        }));
    },
});
