import { cli, Strategy } from '@jackwener/opencli/registry';
import { WRITE_ARGS, WRITE_COLUMNS, parseWriteOptions, runApprovedWrite } from '../_shared/social-write.js';
import { evaluateWrite, parseWriteTarget, preparePrivateWrite } from './write-im.js';

export const command = cli({
    site: 'douyin', name: 'conversation-open', access: 'write', description: '预检查或审批后打开/创建普通用户一对一会话，不发送消息',
    domain: 'www.douyin.com', strategy: Strategy.COOKIE, browser: true, navigateBefore: false,
    args: [{ name: 'target', positional: true, required: true, help: 'Numeric UID, private ID, sec_uid or exact public profile URL' }, ...WRITE_ARGS],
    columns: WRITE_COLUMNS,
    validateArgs: args => { parseWriteTarget(args.target); parseWriteOptions(args); },
    func: async (page, args) => {
        parseWriteTarget(args.target); const options = parseWriteOptions(args);
        const plan = await preparePrivateWrite(page, args.target, 'conversation-open');
        return runApprovedWrite({ ...args, 'request-id': options.requestId }, plan, expiresAt => evaluateWrite(page, {
            ...plan, operation: 'conversation-open', requestId: options.requestId, expiresAt,
        }));
    },
});
