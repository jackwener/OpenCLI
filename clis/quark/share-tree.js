import { cli, Strategy } from '@jackwener/opencli/registry';
import { extractPwdId, formatDate, getShareList, getToken, } from './utils.js';
async function buildTree(page, pwdId, stoken, pdirFid, depth, maxDepth) {
    if (depth > maxDepth)
        return [];
    const files = await getShareList(page, pwdId, stoken, pdirFid, { sort: 'file_type:asc,file_name:asc' });
    const nodes = [];
    for (const file of files) {
        const node = {
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
    access: 'read',
    description: 'Get directory tree from Quark Drive share link as nested JSON',
    domain: 'pan.quark.cn',
    strategy: Strategy.COOKIE,
    defaultFormat: 'json',
    args: [
        { name: 'url', required: true, positional: true, help: 'Quark share URL or pwd_id' },
        { name: 'passcode', default: '', help: 'Share passcode (if required)' },
        { name: 'depth', type: 'int', default: 10, help: 'Max directory depth' },
    ],
    func: async (page, kwargs) => {
        const url = kwargs.url;
        const passcode = kwargs.passcode || '';
        const depth = kwargs.depth ?? 10;
        const pwdId = extractPwdId(url);
        const stoken = await getToken(page, pwdId, passcode);
        const tree = await buildTree(page, pwdId, stoken, '0', 0, depth);
        return { pwd_id: pwdId, stoken, tree };
    },
});
