import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { DRIVE_API, apiPost, findFolder, pollTask } from './utils.js';
cli({
    site: 'quark',
    name: 'mv',
    access: 'write',
    description: 'Move files to a folder in your Quark Drive',
    domain: 'pan.quark.cn',
    strategy: Strategy.COOKIE,
    defaultFormat: 'json',
    timeoutSeconds: 120,
    args: [
        { name: 'fids', required: true, positional: true, help: 'File IDs to move (comma-separated)' },
        { name: 'to', default: '', help: 'Destination folder path (required unless --to-fid is set)' },
        { name: 'to-fid', default: '', help: 'Destination folder ID (overrides --to)' },
    ],
    func: async (page, kwargs) => {
        const to = kwargs.to;
        const toFid = kwargs['to-fid'];
        const fids = kwargs.fids;
        const fidList = [...new Set(fids.split(',').map(id => id.trim()).filter(Boolean))];
        if (fidList.length === 0)
            throw new ArgumentError('No fids provided');
        if (!to && !toFid)
            throw new ArgumentError('Either --to or --to-fid is required');
        if (to && toFid)
            throw new ArgumentError('Cannot use both --to and --to-fid');
        const targetFid = toFid || await findFolder(page, to);
        const data = await apiPost(page, `${DRIVE_API}/move?pr=ucpro&fr=pc`, {
            filelist: fidList,
            to_pdir_fid: targetFid,
        });
        const result = {
            status: 'pending',
            count: fidList.length,
            destination: to || toFid,
            task_id: data.task_id,
            completed: false,
        };
        if (data.task_id) {
            const completed = await pollTask(page, data.task_id);
            result.completed = completed;
            result.status = completed ? 'ok' : 'error';
            if (!completed)
                throw new CommandExecutionError('quark: Move task timed out');
        }
        else {
            result.status = 'ok';
            result.completed = true;
        }
        return result;
    },
});
