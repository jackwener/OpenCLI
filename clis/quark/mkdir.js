import { ArgumentError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { DRIVE_API, apiPost, findFolder } from './utils.js';
cli({
    site: 'quark',
    name: 'mkdir',
    description: 'Create a folder in your Quark Drive',
    domain: 'pan.quark.cn',
    strategy: Strategy.COOKIE,
    defaultFormat: 'json',
    args: [
        { name: 'name', required: true, positional: true, help: 'Folder name' },
        { name: 'parent', help: 'Parent folder path (resolved by name)' },
        { name: 'parent-fid', help: 'Parent folder fid (use directly)' },
    ],
    func: async (page, kwargs) => {
        const name = kwargs.name;
        if (!name.trim())
            throw new ArgumentError('Folder name cannot be empty');
        if (kwargs.parent && kwargs['parent-fid']) {
            throw new ArgumentError('Cannot use both --parent and --parent-fid');
        }
        const parentFid = kwargs['parent-fid']
            ? kwargs['parent-fid']
            : kwargs.parent
                ? await findFolder(page, kwargs.parent)
                : '0';
        const data = await apiPost(page, `${DRIVE_API}?pr=ucpro&fr=pc`, {
            pdir_fid: parentFid,
            file_name: name,
            dir_path: '',
            dir_init_lock: false,
        });
        return { status: 'ok', fid: data.fid, name };
    },
});
