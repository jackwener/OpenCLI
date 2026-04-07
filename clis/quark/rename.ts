import { ArgumentError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import type { IPage } from '@jackwener/opencli/types';
import { DRIVE_API, apiPost } from './utils.js';

interface RenameResult {
  status: string;
  fid: string;
  new_name: string;
}

cli({
  site: 'quark',
  name: 'rename',
  description: 'Rename a file in your Quark Drive',
  domain: 'pan.quark.cn',
  strategy: Strategy.COOKIE,
  defaultFormat: 'json',
  args: [
    { name: 'fid', required: true, positional: true, help: 'File ID to rename' },
    { name: 'name', required: true, help: 'New file name' },
  ],
  func: async (page: IPage, kwargs: Record<string, unknown>): Promise<RenameResult> => {
    const fid = kwargs.fid as string;
    const name = kwargs.name as string;
    if (!name.trim()) throw new ArgumentError('New name cannot be empty');

    await apiPost(page, `${DRIVE_API}/rename?pr=ucpro&fr=pc`, {
      fid,
      file_name: name,
    });

    return { status: 'ok', fid, new_name: name };
  },
});
