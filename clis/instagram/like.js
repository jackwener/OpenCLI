import { cli } from '@jackwener/opencli/registry';
cli({
    site: 'instagram',
    name: 'like',
    description: 'Like an Instagram post',
    domain: 'www.instagram.com',
    args: [
        {
            name: 'username',
            required: true,
            positional: true,
            help: 'Username of the post author',
        },
        { name: 'index', type: 'int', default: 1, help: 'Post index (1 = most recent)' },
    ],
    columns: ['status', 'user', 'post'],
    pipeline: [
        { navigate: 'https://www.instagram.com' },
        { evaluate: `(async () => {
  const username = \${{ args.username | json }};
  const idx = \${{ args.index }} - 1;
  const headers = { 'X-IG-App-ID': '936619743392459' };
  const opts = { credentials: 'include', headers };

  const r1 = await fetch('https://www.instagram.com/api/v1/users/web_profile_info/?username=' + encodeURIComponent(username), opts);
  if (!r1.ok) throw new Error('User not found: ' + username);
  const userId = (await r1.json())?.data?.user?.id;

  const r2 = await fetch('https://www.instagram.com/api/v1/feed/user/' + userId + '/?count=' + (idx + 1), opts);
  const posts = (await r2.json())?.items || [];
  if (idx >= posts.length) throw new Error('Post index ' + (idx + 1) + ' not found, user has ' + posts.length + ' recent posts');
  const pk = posts[idx].pk;
  const caption = (posts[idx].caption?.text || '').substring(0, 60);

  const csrf = document.cookie.match(/csrftoken=([^;]+)/)?.[1] || '';
  const r3 = await fetch('https://www.instagram.com/api/v1/web/likes/' + pk + '/like/', {
    method: 'POST', credentials: 'include',
    headers: { ...headers, 'X-CSRFToken': csrf, 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  if (!r3.ok) throw new Error('Failed to like: HTTP ' + r3.status);
  return [{ status: 'Liked', user: username, post: caption || '(post #' + (idx+1) + ')' }];
})()
` },
    ],
});
