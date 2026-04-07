import { cli, Strategy } from '@jackwener/opencli/registry';
import type { IPage } from '@jackwener/opencli/types';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import {
  SHARE_API,
  extractPwdId,
  getToken,
  formatDate,
  fetchJson,
} from './utils.js';
import type { ShareFile } from './utils.js';

async function getShareList(
  page: IPage,
  pwdId: string,
  stoken: string,
  pdirFid = '0',
  options?: { sort?: string },
): Promise<ShareFile[]> {
  const allFiles: ShareFile[] = [];
  let pageNum = 1;
  let total = 0;

  do {
    const sortParam = options?.sort ? `&_sort=${options.sort}` : '';
    const url = `${SHARE_API}/detail?pr=ucpro&fr=pc&ver=2&pwd_id=${pwdId}&stoken=${encodeURIComponent(stoken)}&pdir_fid=${pdirFid}&force=0&_page=${pageNum}&_size=200&_fetch_total=1${sortParam}`;
    const data = await fetchJson<{ list: ShareFile[] }>(page, url);
    if (data.status !== 200) throw new CommandExecutionError(`quark: Failed to get share list: ${data.message}`);
    const files = data.data?.list || [];
    allFiles.push(...files);
    total = data.metadata?._total || 0;
    pageNum++;
  } while (allFiles.length < total);

  return allFiles;
}

interface QuarkTreeNode {
  fid: string;
  name: string;
  size: number;
  is_dir: boolean;
  created_at: string;
  updated_at: string;
  children?: QuarkTreeNode[];
}

async function buildTree(
  page: IPage,
  pwdId: string,
  stoken: string,
  pdirFid: string,
  depth: number,
  maxDepth: number,
): Promise<QuarkTreeNode[]> {
  if (depth > maxDepth) return [];

  const files = await getShareList(page, pwdId, stoken, pdirFid, { sort: 'file_type:asc,file_name:asc' });
  const nodes: QuarkTreeNode[] = [];

  for (const file of files) {
    const node: QuarkTreeNode = {
      fid: file.fid,
      name: file.file_name,
      size: file.size,
      is_dir: file.dir,
      created_at: formatDate(file.created_at),
      updated_at: formatDate(file.updated_at),
    };

    if (file.dir && depth < maxDepth) {
      node.children = await buildTree(page, pwdId, stoken, file.fid, depth + 1, maxDepth);
    }

    nodes.push(node);
  }

  return nodes;
}

cli({
  site: 'quark',
  name: 'share-tree',
  description: 'Get directory tree from Quark Drive share link as nested JSON',
  domain: 'pan.quark.cn',
  strategy: Strategy.COOKIE,
  defaultFormat: 'json',
  args: [
    { name: 'url', required: true, positional: true, help: 'Quark share URL or pwd_id' },
    { name: 'passcode', default: '', help: 'Share passcode (if required)' },
    { name: 'depth', type: 'int', default: 10, help: 'Max directory depth' },
  ],
  func: async (page: IPage, kwargs: Record<string, unknown>) => {
    const url = kwargs.url as string;
    const passcode = (kwargs.passcode as string) || '';
    const depth = (kwargs.depth as number) ?? 10;

    const pwdId = extractPwdId(url);
    const stoken = await getToken(page, pwdId, passcode);
    const tree = await buildTree(page, pwdId, stoken, '0', 0, depth);

    return { pwd_id: pwdId, stoken, tree };
  },
});
