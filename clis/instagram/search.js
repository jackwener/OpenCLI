import { cli } from '@jackwener/opencli/registry';
cli({
    site: 'instagram',
    name: 'search',
    description: 'Search Instagram users',
    domain: 'www.instagram.com',
    args: [
        { name: 'query', required: true, positional: true, help: 'Search query' },
        { name: 'limit', type: 'int', default: 10, help: 'Number of results' },
    ],
    columns: ['rank', 'username', 'name', 'verified', 'private', 'url'],
    pipeline: [
        { navigate: 'https://www.instagram.com' },
        { evaluate: `(async () => {
  const query = \${{ args.query | json }};
  const limit = \${{ args.limit }};
  const res = await fetch(
    'https://www.instagram.com/web/search/topsearch/?query=' + encodeURIComponent(query) + '&context=user',
    {
      credentials: 'include',
      headers: { 'X-IG-App-ID': '936619743392459' }
    }
  );
  if (!res.ok) throw new Error('HTTP ' + res.status + ' - make sure you are logged in to Instagram');
  const data = await res.json();
  const users = (data?.users || []).slice(0, limit);
  return users.map((item, i) => ({
    rank: i + 1,
    username: item.user?.username || '',
    name: item.user?.full_name || '',
    verified: item.user?.is_verified ? 'Yes' : 'No',
    private: item.user?.is_private ? 'Yes' : 'No',
    url: 'https://www.instagram.com/' + (item.user?.username || ''),
  }));
})()
` },
    ],
});
