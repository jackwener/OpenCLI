import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { firstArray, positiveInteger, postForm, textOrNull, valueFrom } from './utils.js';

const JOBS_PATH = '/api/com.liepin.kuafu.ejobmanage.pc.ejobinfo.query.get-ejob-list';

function mapJob(item) {
    const jobId = valueFrom([item], ['ejobId', 'jobId', 'id']);
    return {
        job_id: jobId,
        title: valueFrom([item], ['ejobTitle', 'jobTitle', 'title']),
        location: valueFrom([item], ['dqName', 'cityName', 'location']),
        status: valueFrom([item], ['statusName', 'jobStatusName', 'ejobStatusName']),
        applicants: valueFrom([item], ['applyCount', 'resumeCount', 'candidateCount']),
        updated_at: valueFrom([item], ['updateTime', 'refreshTime', 'modifiedTime']),
    };
}

cli({
    site: 'liepin',
    name: 'jobs',
    access: 'read',
    description: '列出猎聘企业版招聘职位',
    domain: 'api-lpt.liepin.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    defaultWindowMode: 'background',
    siteSession: 'persistent',
    args: [
        { name: 'keyword', type: 'string', default: '', help: '按职位名称筛选' },
        { name: 'page', type: 'int', default: 1, help: '页码（从 1 开始）' },
        { name: 'limit', type: 'int', default: 20, help: '每页数量（1-50）' },
    ],
    columns: ['job_id', 'title', 'location', 'status', 'applicants', 'updated_at'],
    func: async (page, args) => {
        const pageNumber = positiveInteger(args.page, 'page', 1);
        const limit = positiveInteger(args.limit, 'limit', 20, 50);
        const payload = await postForm(page, JOBS_PATH, {
            keywordKind: 0,
            keyword: textOrNull(args.keyword) ?? '',
            shareFlag: 1,
            curPage: pageNumber - 1,
            pageSize: limit,
            ejobListType: 0,
        });
        const list = firstArray(payload, [['data', 'ejobList'], ['data', 'list']]);
        if (!list) throw new CommandExecutionError('Liepin jobs response did not include a job list');
        const rows = list.map(mapJob).filter((row) => row.job_id || row.title);
        if (rows.length === 0) throw new EmptyResultError('liepin jobs', '没有匹配的招聘职位');
        return rows;
    },
});

export const __test__ = { mapJob };
