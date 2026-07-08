import { cli } from '@jackwener/opencli/registry';
cli({
    site: 'facebook',
    name: 'join-group',
    access: 'write',
    description: 'Join a Facebook group',
    domain: 'www.facebook.com',
    args: [
        {
            name: 'group',
            required: true,
            positional: true,
            help: `Group ID or URL path (e.g. '1876150192925481' or group name)`,
        },
    ],
    columns: ['status', 'group'],
    pipeline: [
        { navigate: { url: 'https://www.facebook.com/groups/${{ args.group }}', settleMs: 3000 } },
        { evaluate: `(async () => {
  const group = \${{ args.group | json }};
  const groupName = document.querySelector('h1')?.textContent?.trim() || group;

  // Find "Join Group" button
  const buttons = Array.from(document.querySelectorAll('[role="button"]'));
  const joinBtn = buttons.find(b => {
    const text = b.textContent.trim();
    return text === '加入小组' || text === 'Join group' || text === 'Join Group';
  });

  if (!joinBtn) {
    const isMember = buttons.some(b => {
      const t = b.textContent.trim();
      return t === '已加入' || t === 'Joined' || t === '成员' || t === 'Member';
    });
    if (isMember) return [{ status: 'Already a member', group: groupName }];
    return [{ status: 'Join button not found', group: groupName }];
  }

  joinBtn.click();
  await new Promise(r => setTimeout(r, 1500));
  return [{ status: 'Join request sent', group: groupName }];
})()
` },
    ],
});
