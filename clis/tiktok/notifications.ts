import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: 'tiktok',
  name: 'notifications',
  description: 'Get TikTok notifications (likes, comments, mentions, followers)',
  domain: 'www.tiktok.com',
  args: [
    { name: 'limit', type: 'int', default: 15, help: 'Number of notifications' },
    {
      name: 'type',
      default: 'all',
      help: 'Notification type',
      choices: ['all', 'likes', 'comments', 'mentions', 'followers'],
    },
  ],
  columns: ['index', 'text'],
  pipeline: [
    { navigate: { url: 'https://www.tiktok.com/following', settleMs: 5000 } },
    { evaluate: `(async () => {
  const limit = \${{ args.limit }};
  const type = \${{ args.type | json }};
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  // Click inbox icon to open notifications panel
  const inboxIcon = document.querySelector('[data-e2e="inbox-icon"]');
  if (inboxIcon) inboxIcon.click();
  await wait(1500);

  // Click specific tab if needed
  if (type !== 'all') {
    const tab = document.querySelector('[data-e2e="' + type + '"]');
    if (tab) {
      tab.click();
      await wait(1500);
    }
  }

  const items = document.querySelectorAll('[data-e2e="inbox-list"] > div, [data-e2e="inbox-list"] [role="button"]');
  return Array.from(items)
    .filter(el => el.textContent.trim().length > 5)
    .slice(0, limit)
    .map((el, i) => ({
      index: i + 1,
      text: el.textContent.trim().replace(/\\s+/g, ' ').substring(0, 150),
    }));
})()
` },
  ],
});
