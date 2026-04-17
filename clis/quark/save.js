import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { SHARE_API, extractPwdId, apiPost, getToken, pollTask, findFolder, } from './utils.js';
async function saveShare(page, pwdId, stoken, fidList, targetFid, saveAll) {
    const data = await apiPost(page, `${SHARE_API}/save?pr=ucpro&fr=pc`, {
        pwd_id: pwdId,
        stoken,
        pdir_fid: '0',
        to_pdir_fid: targetFid,
        fid_list: fidList,
        pdir_save_all: saveAll,
        scene: 'link',
    });
    return data.task_id;
}
cli({
    site: 'quark',
    name: 'save',
    description: 'Save shared files to your Quark Drive',
    domain: 'pan.quark.cn',
    strategy: Strategy.COOKIE,
    defaultFormat: 'json',
    timeoutSeconds: 120,
    args: [
        { name: 'url', required: true, positional: true, help: 'Quark share URL or pwd_id' },
        { name: 'to', default: '', help: 'Destination folder path' },
        { name: 'to-fid', default: '', help: 'Destination folder ID (overrides --to)' },
        { name: 'fids', default: '', help: 'File IDs to save (comma-separated, from share-tree). Omit to save all.' },
        { name: 'stoken', default: '', help: 'Share token (from share-tree output, required with --fids)' },
        { name: 'passcode', default: '', help: 'Share passcode (if required)' },
    ],
    func: async (page, kwargs) => {
        const url = kwargs.url;
        const to = kwargs.to;
        const toFid = kwargs['to-fid'];
        const fids = kwargs.fids;
        const stokenArg = kwargs.stoken;
        const passcode = kwargs.passcode;
        if (!to && !toFid)
            throw new ArgumentError('Either --to or --to-fid is required');
        if (to && toFid)
            throw new ArgumentError('Cannot use both --to and --to-fid');
        const pwdId = extractPwdId(url);
        const saveAll = !fids;
        let stoken;
        let fidList;
        if (saveAll) {
            stoken = stokenArg || await getToken(page, pwdId, passcode);
            fidList = [];
        }
        else {
            if (!stokenArg)
                throw new ArgumentError('--stoken is required when using --fids');
            stoken = stokenArg;
            fidList = [...new Set(fids.split(',').map(id => id.trim()).filter(Boolean))];
        }
        const targetFid = toFid || await findFolder(page, to);
        const taskId = await saveShare(page, pwdId, stoken, fidList, targetFid, saveAll);
        const result = {
            success: false,
            task_id: taskId,
            saved_to: to || toFid,
            target_fid: targetFid,
            ...(saveAll ? {} : { fids: fidList }),
        };
        if (taskId) {
            const completed = await pollTask(page, taskId, (task) => {
                result.save_count = task.save_as?.save_as_sum_num;
            });
            result.completed = completed;
            result.success = completed;
            if (!completed)
                throw new CommandExecutionError('quark: Save task timed out');
        }
        else {
            result.success = true;
        }
        return result;
    },
});
