import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: 'tiktok',
  name: 'like',
  description: 'Like a TikTok video',
  domain: 'www.tiktok.com',
  args: [
    { name: 'url', required: true, positional: true, help: 'TikTok video URL' },
  ],
  columns: ['status', 'likes', 'url'],
  pipeline: [
    { navigate: { url: '${{ args.url }}', settleMs: 6000 } },
    { evaluate: `(async () => {
  const url = \${{ args.url | json }};
  const btn = document.querySelector('[data-e2e="like-icon"]');
  if (!btn) throw new Error('Like button not found - make sure you are logged in');
  const container = btn.closest('button') || btn.closest('[role="button"]') || btn;
  const aria = (container.getAttribute('aria-label') || '').toLowerCase();
  const color = window.getComputedStyle(btn).color;
  const isLiked = aria.includes('unlike') || aria.includes('取消点赞') ||
                  (color && (color.includes('255, 65') || color.includes('fe2c55')));
  if (isLiked) {
    const count = document.querySelector('[data-e2e="like-count"]');
    return [{ status: 'Already liked', likes: count ? count.textContent.trim() : '-', url: url }];
  }
  container.click();
  await new Promise(r => setTimeout(r, 2000));
  const count = document.querySelector('[data-e2e="like-count"]');
  return [{ status: 'Liked', likes: count ? count.textContent.trim() : '-', url: url }];
})()
` },
  ],
});
