import { cli, Strategy } from '@jackwener/opencli/registry';
import type { IPage } from '@jackwener/opencli/types';
import {
  findFolder,
  formatSize,
  listMyDrive,
} from './utils.js';

interface DriveNode {
  name: string;
  fid: string;
  is_dir: boolean;
  size: string;
  path: string;
  children?: DriveNode[];
}

async function buildTree(
  page: IPage,
  pdirFid: string,
  parentPath: string,
  depth: number,
  maxDepth: number,
  dirsOnly: boolean,
): Promise<DriveNode[]> {
  if (depth > maxDepth) return [];

  const files = await listMyDrive(page, pdirFid);
  const nodes: DriveNode[] = [];

  for (const file of files) {
    if (dirsOnly && !file.dir) continue;

    const path = parentPath ? `${parentPath}/${file.file_name}` : file.file_name;
    const node: DriveNode = {
      name: file.file_name,
      fid: file.fid,
      is_dir: file.dir,
      size: formatSize(file.size),
      path,
    };

    if (file.dir && depth < maxDepth) {
      node.children = await buildTree(page, file.fid, path, depth + 1, maxDepth, dirsOnly);
    }

    nodes.push(node);
  }

  return nodes;
}

function flattenTree(nodes: DriveNode[], level = 0): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];
  const indent = '  '.repeat(level);

  for (const node of nodes) {
    result.push({
      name: `${indent}${node.name}`,
      fid: node.fid,
      is_dir: node.is_dir,
      size: node.size,
      path: node.path,
    });
    if (node.children) {
      result.push(...flattenTree(node.children, level + 1));
    }
  }

  return result;
}

cli({
  site: 'quark',
  name: 'ls',
  description: 'List files in your Quark Drive',
  domain: 'pan.quark.cn',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'path', positional: true, default: '', help: 'Folder path to list (empty for root)' },
    { name: 'depth', type: 'int', default: 1, help: 'Max depth to traverse' },
    { name: 'dirs-only', type: 'boolean', default: false, help: 'Show directories only' },
  ],
  columns: ['name', 'is_dir', 'size', 'fid', 'path'],
  func: async (page, kwargs) => {
    const path = (kwargs.path as string) ?? '';
    const depth = Math.max(1, (kwargs.depth as number) ?? 1);
    const dirsOnly = (kwargs['dirs-only'] as boolean) ?? false;

    const rootFid = path ? await findFolder(page, path) : '0';
    const tree = await buildTree(page, rootFid, path, 0, depth, dirsOnly);
    return flattenTree(tree);
  },
});
