import { cli, Strategy } from '@jackwener/opencli/registry';
import { WRITE_ARGS, WRITE_COLUMNS, parseWriteOptions, runApprovedWrite } from '../_shared/social-write.js';
import { parsePrivateUserId } from './im.js';
import { evaluateWrite, preparePrivateWrite } from './write-im.js';

export const command = cli({
    site: 'xiaohongshu', name: 'conversation-open', access: 'write', description: '预检查或审批后准备新作者原生聊天窗口，不发送消息；服务端会话随首条消息建立',
    domain: 'www.xiaohongshu.com', strategy: Strategy.COOKIE, browser: true, navigateBefore: false,
    args: [{ name: 'target', positional: true, required: true, help: '24-character user ID or exact public profile URL' }, ...WRITE_ARGS],
    columns: WRITE_COLUMNS,
    validateArgs: args => { parsePrivateUserId(args.target); parseWriteOptions(args); },
    func: async (page, args) => {
        parsePrivateUserId(args.target); const options = parseWriteOptions(args);
        const plan = await preparePrivateWrite(page, args.target, 'conversation-open');
        return runApprovedWrite({ ...args, 'request-id': options.requestId }, plan, expiresAt => evaluateWrite(page, {
            ...plan, operation: 'conversation-open', requestId: options.requestId, expiresAt,
        }));
    },
});
