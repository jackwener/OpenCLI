import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: 'linux-do',
  name: 'topic',
  description: 'linux.do 帖子首页摘要和回复（首屏）',
  domain: 'linux.do',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'id', type: 'int', required: true, positional: true, help: 'Topic ID' },
    { name: 'limit', type: 'int', default: 20, help: 'Number of posts' },
  ],
  columns: ['author', 'content', 'likes', 'created_at'],
  pipeline: [
    { navigate: 'https://linux.do' },
    { evaluate: `(async () => {
  const toLocalTime = (utcStr) => {
    if (!utcStr) return '';
    const date = new Date(utcStr);
    return Number.isNaN(date.getTime()) ? utcStr : date.toLocaleString();
  };
  const res = await fetch('/t/\${{ args.id }}.json', { credentials: 'include' });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' - 请先登录 linux.do');
  let data;
  try { data = await res.json(); } catch { throw new Error('响应不是有效 JSON - 请先登录 linux.do'); }
  const strip = (html) => (html || '')
    .replace(/<br\\s*\\/?>/gi, ' ')
    .replace(/<\\/(p|div|li|blockquote|h[1-6])>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(?:(\\d+)|x([0-9a-fA-F]+));/g, (_, dec, hex) => {
      try { return String.fromCodePoint(dec !== undefined ? Number(dec) : parseInt(hex, 16)); } catch { return ''; }
    })
    .replace(/\\s+/g, ' ')
    .trim();
  const posts = data?.post_stream?.posts || [];
  return posts.slice(0, \${{ args.limit }}).map(p => ({
    author: p.username,
    content: strip(p.cooked).slice(0, 200),
    likes: p.like_count,
    created_at: toLocalTime(p.created_at),
  }));
})()
` },
    { map: {
        author: '${{ item.author }}',
        content: '${{ item.content }}',
        likes: '${{ item.likes }}',
        created_at: '${{ item.created_at }}',
      } },
  ],
});
