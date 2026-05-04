import { cli } from '@jackwener/opencli/registry';
cli({
    site: 'tiktok',
    name: 'unfollow',
    access: 'write',
    description: 'Unfollow a TikTok user',
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
  const followingBtn = buttons.find(function(b) {
    var text = b.textContent.trim();
    return text === 'Following' || text === '已关注' || text === 'Friends' || text === '互关';
  });
  if (!followingBtn) {
    return [{ status: 'Not following this user', username: username }];
  }
  followingBtn.click();
  await new Promise(r => setTimeout(r, 2000));
  // Confirm unfollow if dialog appears
  var allBtns = Array.from(document.querySelectorAll('button'));
  var confirm = allBtns.find(function(b) {
    var t = b.textContent.trim();
    return t === 'Unfollow' || t === '取消关注';
  });
  if (confirm) {
    confirm.click();
    await new Promise(r => setTimeout(r, 1500));
  }
  return [{ status: 'Unfollowed', username: username }];
})()
` },
    ],
});
