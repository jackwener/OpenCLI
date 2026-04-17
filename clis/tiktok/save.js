import { cli } from '@jackwener/opencli/registry';
cli({
    site: 'tiktok',
    name: 'save',
    description: 'Add a TikTok video to Favorites',
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
  if (aria.includes('remove from favorites') || aria.includes('取消收藏')) {
    return [{ status: 'Already in Favorites', url: url }];
  }
  container.click();
  await new Promise(r => setTimeout(r, 2000));
  return [{ status: 'Added to Favorites', url: url }];
})()
` },
    ],
});
