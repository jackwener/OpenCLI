import { cli, Strategy } from '@jackwener/opencli/registry';
import { ensureZsxqAuth, ensureZsxqPage, fetchFirstJson, getTopicText, getTopicAuthor, getTopicUrl, } from './utils.js';
cli({
    site: 'zsxq',
    name: 'dynamics',
    access: 'read',
    description: '获取所有星球的最新动态',
    domain: 'wx.zsxq.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Number of dynamics to return' },
    ],
    columns: ['time', 'group', 'author', 'title', 'comments', 'likes', 'url'],
    func: async (page, kwargs) => {
        await ensureZsxqPage(page);
        await ensureZsxqAuth(page);
        const limit = Math.max(1, Number(kwargs.limit) || 20);
        const { data } = await fetchFirstJson(page, [
            `https://api.zsxq.com/v2/dynamics?scope=general&count=${limit}`,
        ]);
        const respData = data?.resp_data || data;
        const dynamics = respData?.dynamics || [];
        return dynamics.slice(0, limit).map((d) => {
            const topic = d.topic;
            if (!topic) {
                return {
                    time: d.create_time || '',
                    group: '',
                    author: '',
                    title: `[${d.action || 'unknown'}]`,
                    comments: 0,
                    likes: 0,
                    url: '',
                };
            }
            return {
                time: d.create_time || topic.create_time || '',
                group: topic.group?.name || '',
                author: getTopicAuthor(topic),
                title: getTopicText(topic),
                comments: topic.comments_count ?? 0,
                likes: topic.likes_count ?? 0,
                url: getTopicUrl(topic.topic_id),
            };
        });
    },
});
