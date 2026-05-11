import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';
import { onesFetchInPage } from './common.js';
import { formatStamp } from './task-helpers.js';
/**
 * 工作项详情 — 对应前端路由 …/team/<team>/filter/view/…/task/<uuid>
 * API: GET team/:teamUUID/task/:taskUUIDOrNumber/info
 * @see https://docs.ones.cn/project/open-api-doc/project/task.html
 */
cli({
    site: 'ones',
    name: 'task',
    access: 'read',
    description: 'ONES — work item detail (GET team/:team/task/:id/info); id is URL segment after …/task/',
    domain: 'ones.cn',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        {
            name: 'id',
            type: 'str',
            required: true,
            positional: true,
            help: 'Work item UUID (often 16 chars) from …/task/<id>',
        },
        {
            name: 'team',
            type: 'str',
            required: false,
            help: 'Team UUID (8 chars from …/team/<team>/…), or set ONES_TEAM_UUID',
        },
    ],
    columns: ['uuid', 'summary', 'number', 'status_uuid', 'assign', 'owner', 'project_uuid', 'updated'],
    func: async (page, kwargs) => {
        const id = String(kwargs.id ?? '').trim();
        if (!id) {
            throw new CliError('CONFIG', 'task id required', 'Pass the work item uuid from the URL path …/task/<id>');
        }
        const team = kwargs.team?.trim() ||
            process.env.ONES_TEAM_UUID?.trim() ||
            process.env.ONES_TEAM_ID?.trim();
        if (!team) {
            throw new CliError('CONFIG', 'team UUID required', 'Use --team <teamUUID> or set ONES_TEAM_UUID (from …/team/<team>/…).');
        }
        const path = `team/${team}/task/${encodeURIComponent(id)}/info`;
        const data = (await onesFetchInPage(page, path, { method: 'GET' }));
        if (typeof data.uuid !== 'string') {
            const hint = typeof data.reason === 'string'
                ? data.reason
                : 'Use -f json to inspect response; check id length (often 16) and team.';
            throw new CliError('FETCH_ERROR', `ONES task info: ${hint}`, 'Confirm task uuid and team match the browser URL.');
        }
        return [
            {
                uuid: String(data.uuid),
                summary: String(data.summary ?? ''),
                number: data.number != null ? String(data.number) : '',
                status_uuid: String(data.status_uuid ?? ''),
                assign: String(data.assign ?? ''),
                owner: String(data.owner ?? ''),
                project_uuid: String(data.project_uuid ?? ''),
                updated: formatStamp(data.server_update_stamp),
            },
        ];
    },
});
