import { cli } from '@jackwener/opencli/registry';
cli({
    site: 'tiktok',
    name: 'follow',
    description: 'Follow a TikTok user',
    domain: 'www.tiktok.com',
    args: [
        {
            name: 'username',
            required: true,
            positional: true,
            help: 'TikTok username (without @)',
        },
    ],
    columns: ['status', 'username'],
    pipeline: [
        { navigate: { url: 'https://www.tiktok.com/@${{ args.username }}', settleMs: 6000 } },
        { evaluate: `(async () => {
  const username = \${{ args.username | json }};
  const buttons = Array.from(document.querySelectorAll('button, [role="button"]'));
  const followBtn = buttons.find(function(b) {
    var text = b.textContent.trim();
    return text === 'Follow' || text === '关注';
  });
  if (!followBtn) {
    var isFollowing = buttons.some(function(b) {
      var t = b.textContent.trim();
      return t === 'Following' || t === '已关注' || t === 'Friends' || t === '互关';
    });
    if (isFollowing) return [{ status: 'Already following', username: username }];
    return [{ status: 'Follow button not found', username: username }];
  }
  followBtn.click();
  await new Promise(r => setTimeout(r, 2000));
  return [{ status: 'Followed', username: username }];
})()
` },
    ],
});
