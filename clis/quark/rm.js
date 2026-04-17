import { ArgumentError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { DRIVE_API, apiPost } from './utils.js';
cli({
    site: 'quark',
    name: 'rm',
    description: 'Delete files from your Quark Drive',
    domain: 'pan.quark.cn',
    strategy: Strategy.COOKIE,
    defaultFormat: 'json',
    args: [
        { name: 'fids', required: true, positional: true, help: 'File IDs to delete (comma-separated)' },
    ],
    func: async (page, kwargs) => {
        const fids = kwargs.fids;
        const fidList = [...new Set(fids.split(',').map(id => id.trim()).filter(Boolean))];
        if (fidList.length === 0)
            throw new ArgumentError('No fids provided');
        await apiPost(page, `${DRIVE_API}/delete?pr=ucpro&fr=pc`, {
            filelist: fidList,
        });
        return { status: 'ok', count: fidList.length, deleted_fids: fidList };
    },
});
