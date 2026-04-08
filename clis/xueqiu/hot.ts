import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: 'xueqiu',
  name: 'hot',
  description: '获取雪球热门动态',
  domain: 'xueqiu.com',
  browser: true,
  args: [
    { name: 'limit', type: 'int', default: 20, help: '返回数量，默认 20，最大 50' },
  ],
  columns: ['rank', 'author', 'text', 'likes', 'url'],
  pipeline: [
    { navigate: 'https://xueqiu.com' },
    { evaluate: `(async () => {
  const resp = await fetch('https://xueqiu.com/statuses/hot/listV3.json?source=hot&page=1', {credentials: 'include'});
  if (!resp.ok) throw new Error('HTTP ' + resp.status + ' Hint: Not logged in?');
  const d = await resp.json();
  const list = d.list || [];
  
  const strip = (html) => (html || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
  return list.map((item, i) => {
    const user = item.user || {};
    return {
      rank: i + 1,
      text: strip(item.description).substring(0, 200),
      url: 'https://xueqiu.com/' + user.id + '/' + item.id,
      author: user.screen_name,
      likes: item.fav_count,
      retweets: item.retweet_count,
      replies: item.reply_count
    };
  });
})()
` },
    { map: {
        rank: '${{ item.rank }}',
        author: '${{ item.author }}',
        text: '${{ item.text }}',
        likes: '${{ item.likes }}',
        url: '${{ item.url }}',
      } },
    { limit: '${{ args.limit }}' },
  ],
});
