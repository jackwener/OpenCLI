import { cli } from '@jackwener/opencli/registry';
cli({
    site: 'instagram',
    name: 'unfollow',
    access: 'write',
    description: 'Unfollow an Instagram user',
    domain: 'www.instagram.com',
    args: [
        {
            name: 'username',
            required: true,
            positional: true,
            help: 'Instagram username to unfollow',
        },
    ],
    columns: ['status', 'username'],
    pipeline: [
        { navigate: 'https://www.instagram.com' },
        { evaluate: `(async () => {
  const username = \${{ args.username | json }};
  const headers = { 'X-IG-App-ID': '936619743392459' };
  const opts = { credentials: 'include', headers };

  const r1 = await fetch('https://www.instagram.com/api/v1/users/web_profile_info/?username=' + encodeURIComponent(username), opts);
  if (!r1.ok) throw new Error('User not found: ' + username);
  const d1 = await r1.json();
  const userId = d1?.data?.user?.id;
  if (!userId) throw new Error('User not found: ' + username);

  const csrf = document.cookie.match(/csrftoken=([^;]+)/)?.[1] || '';
  const r2 = await fetch('https://www.instagram.com/api/v1/friendships/destroy/' + userId + '/', {
    method: 'POST',
    credentials: 'include',
    headers: { ...headers, 'X-CSRFToken': csrf, 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  if (!r2.ok) throw new Error('Failed to unfollow: HTTP ' + r2.status);
  return [{ status: 'Unfollowed', username }];
})()
` },
    ],
});
