import { ArgumentError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import type { IPage } from '@jackwener/opencli/types';
import { DRIVE_API, apiPost, findFolder, pollTask } from './utils.js';

interface MoveResult {
  status: string;
  count: number;
  destination: string;
  task_id: string;
  completed: boolean;
}

cli({
  site: 'quark',
  name: 'mv',
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
  func: async (page: IPage, kwargs: Record<string, unknown>): Promise<MoveResult> => {
    const to = kwargs.to as string;
    const toFid = kwargs['to-fid'] as string;
    const fids = kwargs.fids as string;
    const fidList = [...new Set(fids.split(',').map(id => id.trim()).filter(Boolean))];
    if (fidList.length === 0) throw new ArgumentError('No fids provided');
    if (!to && !toFid) throw new ArgumentError('Either --to or --to-fid is required');

    const targetFid = toFid || await findFolder(page, to);
    const data = await apiPost<{ task_id: string }>(page, `${DRIVE_API}/move?pr=ucpro&fr=pc`, {
      filelist: fidList,
      to_pdir_fid: targetFid,
    });

    const result: MoveResult = {
      status: 'ok',
      count: fidList.length,
      destination: to || toFid,
      task_id: data.task_id,
      completed: false,
    };

    if (data.task_id) {
      result.completed = await pollTask(page, data.task_id);
    }

    return result;
  },
});
