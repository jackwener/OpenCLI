import { cli } from '@jackwener/opencli/registry';
cli({
    site: 'tiktok',
    name: 'unsave',
    access: 'write',
    description: 'Remove a TikTok video from Favorites',
    domain: 'www.tiktok.com',
    args: [
        { name: 'url', required: true, positional: true, help: 'TikTok video URL' },
    ],
    columns: ['status', 'url'],
    pipeline: [
        { navigate: { url: '${{ args.url }}', settleMs: 6000 } },
        { evaluate: `(async () => {
  const url = \${{ args.url | json }};
  const btn = document.querySelector('[data-e2e="bookmark-icon"]') ||
              document.querySelector('[data-e2e="collect-icon"]');
  if (!btn) throw new Error('Favorites button not found - make sure you are logged in');
  const container = btn.closest('button') || btn.closest('[role="button"]') || btn;
  const aria = (container.getAttribute('aria-label') || '').toLowerCase();
  if (aria.includes('add to favorites') || aria.includes('收藏')) {
    if (!aria.includes('remove') && !aria.includes('取消')) {
      return [{ status: 'Not in Favorites', url: url }];
    }
  }
  container.click();
  await new Promise(r => setTimeout(r, 2000));
  return [{ status: 'Removed from Favorites', url: url }];
})()
` },
    ],
});
