import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: 'hupu',
  name: 'hot',
  description: '虎扑热门帖子',
  domain: 'bbs.hupu.com',
  args: [
    { name: 'limit', type: 'int', default: 20, help: 'Number of hot posts' },
  ],
  columns: ['rank', 'title', 'url'],
  pipeline: [
    { navigate: 'https://bbs.hupu.com/' },
    { evaluate: `(async () => {
  // 从HTML中提取帖子信息（适配新的HTML结构）
  const html = document.documentElement.outerHTML;
  const posts = [];

  // 匹配当前虎扑页面结构的正则表达式
  // 结构: <a href="/638249612.html"...><span class="t-title">标题</span></a>
  const regex = /<a[^>]*href="\\/(\\d{9})\\.html"[^>]*><span[^>]*class="t-title"[^>]*>([^<]+)<\\/span><\\/a>/g;
  let match;

  while ((match = regex.exec(html)) !== null && posts.length < \${{ args.limit }}) {
    posts.push({
      tid: match[1],
      title: match[2].trim()
    });
  }

  return posts;
})()
` },
    { map: {
        rank: '${{ index + 1 }}',
        title: '${{ item.title }}',
        url: 'https://bbs.hupu.com/${{ item.tid }}.html',
      } },
    { limit: '${{ args.limit }}' },
  ],
});
