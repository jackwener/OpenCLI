import { cli, Strategy } from '../../registry.js';

// 映射表：数组的索引(0,1,2...)代表用户输入的 type，数组的值代表新浪 API 真实的 tag ID
const TYPE_MAP = [
    0,   // index 0: 全部
    10,  // index 1: A股
    1,   // index 2: 宏观
    3,   // index 3: 公司
    4,   // index 4: 数据
    5,   // index 5: 市场
    102, // index 6: 国际
    6,   // index 7: 观点
    6,   // index 8: 央行 (原代码中观点和央行都是6，这里保留原逻辑)
    8    // index 9: 其它
];

cli({
    site: 'sinafinance',
    name: '724',
    description: '新浪财经 7x24 小时实时快讯',
    domain: 'app.cj.sina.com.cn',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Max results, max 50' },
        // 0-9 分别对应什么
        { name: 'type', type: 'int', default: 0, help: 'Type of news, 0: 全部, 1: A股, 2: 宏观, 3: 公司, 4: 数据, 5: 市场, 6: 国际, 7: 观点, 8: 央行, 9: 其它' },
    ],
    columns: ['id', 'time', 'content', 'views'],
    func: async (_page, args) => {

        // 将用户输入的 0-9 转换为 API 真实的 tag ID。
        // 容错处理：如果用户输入了越界数字(比如 99)，默认回退到 0 (全部)
        const apiTag = TYPE_MAP[args.type] !== undefined ? TYPE_MAP[args.type] : 0;

        const params = new URLSearchParams({
            page: '1',
            size: String(args.limit),
            tag: String(apiTag), // 使用映射后的真实 ID
            _: String(Date.now())
        });

        const res = await fetch(`https://app.cj.sina.com.cn/api/news/pc?${params}`);
        const json = await res.json();

        const list = json?.result?.data?.feed?.list || [];

        return list.map((item: any) => ({
            id: item.id,
            time: item.create_time,
            content: item.rich_text,
            views: item.view_num
        }));
    },
});