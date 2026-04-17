import { cli } from '@jackwener/opencli/registry';
cli({
    site: 'facebook',
    name: 'notifications',
    description: 'Get recent Facebook notifications',
    domain: 'www.facebook.com',
    args: [
        { name: 'limit', type: 'int', default: 15, help: 'Number of notifications' },
    ],
    columns: ['index', 'text', 'time'],
    pipeline: [
        { navigate: { url: 'https://www.facebook.com/notifications', settleMs: 3000 } },
        { evaluate: `(() => {
  const limit = \${{ args.limit }};
  const items = document.querySelectorAll('[role="listitem"]');
  return Array.from(items)
    .filter(el => el.querySelectorAll('a').length > 0)
    .slice(0, limit)
    .map((el, i) => {
      const raw = el.textContent.trim().replace(/\\s+/g, ' ');
      // Remove leading "未读" and trailing "标记为已读"
      const cleaned = raw.replace(/^未读/, '').replace(/标记为已读$/, '').replace(/^Unread/, '').replace(/Mark as read$/, '').trim();
      // Try to extract time (last segment like "11小时", "5天", "1周")
      const timeMatch = cleaned.match(/(\\d+\\s*(?:分钟|小时|天|周|个月|minutes?|hours?|days?|weeks?|months?))\\s*$/);
      const time = timeMatch ? timeMatch[1] : '';
      const text = timeMatch ? cleaned.slice(0, -timeMatch[0].length).trim() : cleaned;
      return {
        index: i + 1,
        text: text.substring(0, 150),
        time: time || '-',
      };
    });
})()
` },
    ],
});
