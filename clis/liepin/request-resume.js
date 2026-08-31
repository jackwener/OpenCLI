import { cli, Strategy } from '@jackwener/opencli/registry';
import { postForm, requireConfirmation, requiredText, textOrNull } from './utils.js';

const REQUEST_RESUME_PATH = '/api/com.liepin.im.b.askfor.send-askfor-request';

cli({
    site: 'liepin',
    name: 'request-resume',
    access: 'write',
    description: '向猎聘沟通对象发送平台内置的简历请求',
    domain: 'api-lpt.liepin.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    defaultWindowMode: 'background',
    siteSession: 'persistent',
    args: [
        { name: 'oppositeImId', type: 'string', required: true, positional: true, help: '对方 IM ID（来自 search 或 chats）' },
        { name: 'confirm', type: 'boolean', default: false, help: '必须显式传 true 才会发送' },
    ],
    columns: ['status', 'opposite_im_id', 'biz_type', 'message'],
    func: async (page, args) => {
        const oppositeImId = requiredText(args.oppositeImId, 'oppositeImId');
        requireConfirmation(args.confirm, 'request-resume');
        const payload = await postForm(page, REQUEST_RESUME_PATH, {
            oppositeImId,
            bizType: 3,
        }, 'https://lpt.liepin.com/chat/im');
        return [{
            status: 'sent',
            opposite_im_id: oppositeImId,
            biz_type: 3,
            message: textOrNull(payload.msg) ?? '简历请求已发送',
        }];
    },
});
