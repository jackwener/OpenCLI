import { cli } from '@jackwener/opencli/registry';

export function parseToutiaoArticlesText(text) {
    const NON_TITLE_LINES = new Set([
        '展现', '阅读', '点赞', '评论',
        '查看数据', '查看评论', '修改', '更多', '首发',
        '已发布', '定时发布', '定时发布中', '由文章生成', '审核中',
    ]);
    const lines = String(text || '').split('\n').map((line) => line.trim()).filter(Boolean);
    const results = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!/^\d{2}-\d{2}\s+\d{2}:\d{2}$/.test(line)) continue;

        const date = line;
        let title = '';
        let status = '';
        let stats = null;

        for (let back = 3; back >= 1; back--) {
            const prev = lines[i - back] || '';
            if (!prev || prev.length >= 100 || /^\d+$/.test(prev) || NON_TITLE_LINES.has(prev)) continue;
            title = prev;
            break;
        }

        for (let fwd = 1; fwd < 8; fwd++) {
            const fwdLine = lines[i + fwd] || '';
            if (fwdLine === '已发布' || fwdLine === '定时发布中' || fwdLine === '审核中' || fwdLine === '由文章生成') {
                status = fwdLine;
            }
            if (fwdLine.includes('展现') && fwdLine.includes('阅读')) {
                const match = fwdLine.match(/展现\s*([\d,]+)\s*阅读\s*([\d,]+)\s*点赞\s*([\d,]+)\s*评论\s*([\d,]*)/);
                if (match) {
                    stats = {
                        '展现': match[1],
                        '阅读': match[2],
                        '点赞': match[3],
                        '评论': match[4] || '0',
                    };
                }
            }
        }

        if (title && stats) results.push({ title, date, status, ...stats });
    }

    return results;
}

cli({
    site: 'toutiao',
    name: 'articles',
    access: 'read',
    description: '获取头条号创作者后台文章列表及数据',
    domain: 'mp.toutiao.com',
    args: [
        { name: 'page', type: 'int', default: 1, help: '页码 (1-4)' },
    ],
    columns: ['title', 'date', 'status', '展现', '阅读', '点赞', '评论'],
    pipeline: [
        { navigate: 'https://mp.toutiao.com/profile_v4/manage/content/all?page=${{ args.page }}' },
        { wait: 'networkidle' },
        { wait: 3000 },
        {
            evaluate: `
(async () => {
    // Wait for content to load
    await new Promise(r => setTimeout(r, 2000));
    const parse = ${parseToutiaoArticlesText.toString()};
    return parse(document.body.innerText || '');
})()
`
        },
    ],
});

export const __test__ = {
    parseToutiaoArticlesText,
};
