import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { firstArray, get, positiveInteger, valueFrom } from './utils.js';

const ORDERS_URL = 'https://api-bgod.liepin.com/api/com.liepin.god.intention.order.get-order-list';

function mapOrder(item) {
    const resume = item?.orderResumeVo ?? {};
    const order = item?.orderInfoVo ?? {};
    const job = item?.orderEJobVo ?? {};
    const report = item?.reportVo ?? {};
    return {
        order_id: valueFrom([order], ['orderId', 'orderNo']),
        resume_id: valueFrom([resume], ['resIdEncode']),
        name: valueFrom([resume], ['cNameShow']),
        location: valueFrom([resume], ['resDqName']),
        work_years: valueFrom([resume], ['resWorkyearAge']),
        degree: valueFrom([resume], ['resEdulevelName']),
        age: valueFrom([resume], ['resBirthYearAge']),
        latest_company: valueFrom([resume], ['resCompany']),
        latest_title: valueFrom([resume], ['resTitle']),
        target_job: valueFrom([job], ['ejobTitle', 'jobTitle']),
        intention: valueFrom([report, order], ['intentionResultShow', 'statusShow', 'statusName']),
        reminder: valueFrom([report], ['reminderShow']),
    };
}

cli({
    site: 'liepin',
    name: 'intention-orders',
    access: 'read',
    description: '列出猎聘意向沟通中的候选人',
    domain: 'api-bgod.liepin.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    defaultWindowMode: 'background',
    siteSession: 'persistent',
    args: [
        { name: 'page', type: 'int', default: 1, help: '页码（从 1 开始）' },
        { name: 'limit', type: 'int', default: 10, help: '返回数量（1-20）' },
        { name: 'jobId', type: 'string', default: '0', help: '职位 ID；0 表示全部' },
    ],
    columns: [
        'order_id', 'resume_id', 'name', 'location', 'work_years', 'degree',
        'age', 'latest_company', 'latest_title', 'target_job', 'intention', 'reminder',
    ],
    func: async (page, args) => {
        const pageNumber = positiveInteger(args.page, 'page', 1);
        const limit = positiveInteger(args.limit, 'limit', 10, 20);
        const payload = await get(page, ORDERS_URL, {}, 'https://msk.liepin.com/intention/order');
        const list = firstArray(payload, [['data', 'list']]);
        if (!list) throw new CommandExecutionError('Liepin intention response did not include data.list');
        const rows = list.map(mapOrder).filter((row) => row.resume_id || row.name);
        if (rows.length === 0) throw new EmptyResultError('liepin intention-orders', '没有意向沟通候选人');
        return rows;
    },
});

export const __test__ = { mapOrder };
