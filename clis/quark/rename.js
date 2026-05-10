import { ArgumentError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { DRIVE_API, apiPost } from './utils.js';
cli({
    site: 'quark',
    name: 'rename',
    access: 'write',
    description: 'Rename a file in your Quark Drive',
    domain: 'pan.quark.cn',
    strategy: Strategy.COOKIE,
    defaultFormat: 'json',
    args: [
        { name: 'fid', required: true, positional: true, help: 'File ID to rename' },
        { name: 'name', required: true, help: 'New file name' },
    ],
    func: async (page, kwargs) => {
        const fid = kwargs.fid;
        const name = kwargs.name;
        if (!name.trim())
            throw new ArgumentError('New name cannot be empty');
        await apiPost(page, `${DRIVE_API}/rename?pr=ucpro&fr=pc`, {
            fid,
            file_name: name,
        });
        return { status: 'ok', fid, new_name: name };
    },
});
