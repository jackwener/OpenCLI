import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: 'pixiv',
  name: 'user',
  description: 'View Pixiv artist profile',
  domain: 'www.pixiv.net',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'uid', required: true, positional: true, help: 'Pixiv user ID' },
  ],
  columns: [
    'user_id',
    'name',
    'premium',
    'following',
    'illusts',
    'manga',
    'novels',
    'comment',
  ],
  pipeline: [
    { navigate: 'https://www.pixiv.net' },
    { evaluate: `(async () => {
  const uid = \${{ args.uid | json }};
  const res = await fetch(
    'https://www.pixiv.net/ajax/user/' + uid + '?full=1',
    { credentials: 'include' }
  );
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new Error('Authentication required — please log in to Pixiv in Chrome');
    if (res.status === 404) throw new Error('User not found: ' + uid);
    throw new Error('Pixiv request failed (HTTP ' + res.status + ')');
  }
  const data = await res.json();
  const b = data?.body;
  if (!b) throw new Error('User not found');
  return [{
    user_id: uid,
    name: b.name,
    premium: b.premium ? 'Yes' : 'No',
    following: b.following,
    illusts: typeof b.illusts === 'object' ? Object.keys(b.illusts).length : (b.illusts || 0),
    manga: typeof b.manga === 'object' ? Object.keys(b.manga).length : (b.manga || 0),
    novels: typeof b.novels === 'object' ? Object.keys(b.novels).length : (b.novels || 0),
    comment: (b.comment || '').slice(0, 80),
    url: 'https://www.pixiv.net/users/' + uid
  }];
})()
` },
  ],
});
