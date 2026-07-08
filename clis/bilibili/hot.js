import { cli } from '@jackwener/opencli/registry';
cli({
    site: 'bilibili',
    name: 'hot',
    access: 'read',
    description: 'B站热门视频',
    domain: 'www.bilibili.com',
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Number of videos' },
    ],
    columns: ['rank', 'title', 'author', 'play', 'danmaku', 'bvid', 'url'],
    pipeline: [
        { navigate: 'https://www.bilibili.com' },
        { evaluate: `(async () => {
  const res = await fetch('https://api.bilibili.com/x/web-interface/popular?ps=\${{ args.limit }}&pn=1', {
    credentials: 'include'
  });
  const data = await res.json();
  return (data?.data?.list || []).map((item) => ({
    title: item.title,
    author: item.owner?.name,
    play: item.stat?.view,
    danmaku: item.stat?.danmaku,
    bvid: item.bvid,
    url: item.bvid ? 'https://www.bilibili.com/video/' + item.bvid : '',
  }));
})()
` },
        { map: {
                rank: '${{ index + 1 }}',
                title: '${{ item.title }}',
                author: '${{ item.author }}',
                play: '${{ item.play }}',
                danmaku: '${{ item.danmaku }}',
                bvid: '${{ item.bvid }}',
                url: '${{ item.url }}',
            } },
        { limit: '${{ args.limit }}' },
    ],
});
