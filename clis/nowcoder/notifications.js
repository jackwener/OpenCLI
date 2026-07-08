import { cli } from '@jackwener/opencli/registry';

cli({
    site: 'nowcoder',
    name: 'notifications',
    access: 'read',
    description: 'Unread message summary',
    domain: 'www.nowcoder.com',
    args: [],
    columns: ['type', 'unread'],
    pipeline: [
        { navigate: 'https://www.nowcoder.com' },
        { evaluate: `(async () => {
  const r = await fetch('https://gw-c.nowcoder.com/api/sparta/message/pc/unread/detail', {credentials: 'include'});
  const d = await r.json();
  if (!d.success) throw new Error(d.msg || 'API failed');
  const data = d.data;
  return [
    {type: 'system', unread: data.systemNotice?.unreadCount || 0},
    {type: 'likes', unread: data.likeCollect?.unreadCount || 0},
    {type: 'comments', unread: data.commentMessage?.unreadCount || 0},
    {type: 'follows', unread: data.followMessage?.unreadCount || 0},
    {type: 'messages', unread: data.privateMessage?.unreadCount || 0},
    {type: 'job_apply', unread: data.nowPickJobApply?.unreadCount || 0},
    {type: 'total', unread: data.total?.unreadCount || 0},
  ];
})()
` },
    ],
});
