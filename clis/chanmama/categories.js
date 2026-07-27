import { cli, Strategy } from '@jackwener/opencli/registry';
import {
  BASE_URL,
  ArgumentError,
  CommandExecutionError,
  EmptyResultError,
  assertChanMamaPage,
  integerInRange,
} from './_shared.js';

cli({
  site: 'chanmama',
  name: 'categories',
  description: '读取蝉妈妈商品类目树，可按名称搜索或展开指定根节点',
  access: 'read',
  example: 'opencli chanmama categories --query 钓鱼 --limit 200 -f json',
  domain: 'chanmama.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  siteSession: 'persistent',
  defaultWindowMode: 'background',
  args: [
    { name: 'query', type: 'string', default: '', help: '按类目名称或完整路径模糊搜索' },
    { name: 'root', type: 'string', default: '', help: '只输出该类目ID及其后代' },
    { name: 'max-depth', type: 'int', default: 8, help: '最多输出层级，范围 1-8' },
    { name: 'limit', type: 'int', default: 500, help: '返回节点数量，范围 1-5000' },
  ],
  columns: ['level', 'id', 'label', 'path', 'parentId', 'childCount', 'isLeaf', 'rootId', 'rootLabel'],
  func: async (page, args) => {
    const query = String(args.query || '').trim().toLowerCase();
    const root = String(args.root || '').trim();
    const maxDepth = integerInRange(args['max-depth'] ?? 8, 'max-depth', 1, 8);
    const limit = integerInRange(args.limit ?? 500, 'limit', 1, 5000);
    if (root && !/^\d+$/.test(root)) throw new ArgumentError('root must be a numeric category id');

    const currentUrl = await page.evaluate(() => location.href).catch(() => '');
    if (!/chanmama\.com/.test(currentUrl || '')) {
      await page.goto(`${BASE_URL}/promotionRank/`);
      await page.wait(2);
    }
    await assertChanMamaPage(page);

    const tree = await page.evaluate(`async () => {
      const response = await fetch('https://api-service.chanmama.com/v1/product/categoryV7?deep=6', { credentials: 'include' });
      if (!response.ok) throw new Error('categoryV7 HTTP ' + response.status);
      const body = await response.json();
      return body?.data;
    }`).catch((error) => {
      throw new CommandExecutionError(`Failed to load ChanMama category tree: ${error.message}`);
    });
    if (!Array.isArray(tree)) throw new CommandExecutionError('ChanMama category response is not an array');

    const findNode = (nodes, id) => {
      for (const node of nodes) {
        if (String(node.id) === id) return node;
        const found = findNode(Array.isArray(node.sub) ? node.sub : [], id);
        if (found) return found;
      }
      return null;
    };
    const roots = root ? [findNode(tree, root)].filter(Boolean) : tree;
    if (root && roots.length === 0) throw new EmptyResultError('chanmama categories', `root=${root}`);

    const rows = [];
    const walk = (node, parents, rootNode) => {
      const pathParts = [...parents.map((item) => item.label), node.label];
      const path = pathParts.join(' > ');
      const children = Array.isArray(node.sub) ? node.sub : [];
      const row = {
        level: parents.length + 1,
        id: node.id,
        label: node.label,
        path,
        parentId: parents.at(-1)?.id ?? null,
        childCount: children.length,
        isLeaf: children.length === 0,
        rootId: rootNode.id,
        rootLabel: rootNode.label,
      };
      if ((!query || node.label.toLowerCase().includes(query) || path.toLowerCase().includes(query)) && row.level <= maxDepth) {
        rows.push(row);
      }
      if (row.level < maxDepth) children.forEach((child) => walk(child, [...parents, node], rootNode));
    };
    roots.forEach((node) => walk(node, [], node));
    const output = rows.slice(0, limit);
    if (output.length === 0) throw new EmptyResultError('chanmama categories', query ? `query=${query}` : 'no nodes');
    return output;
  },
});
