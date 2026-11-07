import { readInstagramJsonJs, runInstagramRead } from './_shared/read-response.js';
import { cli } from '@jackwener/opencli/registry';
cli({
    site: 'instagram',
    name: 'search',
    access: 'read',
    description: 'Search Instagram users',
    domain: 'www.instagram.com',
    args: [
        { name: 'query', required: true, positional: true, help: 'Search query' },
        { name: 'limit', type: 'int', default: 10, help: 'Number of results' },
    ],
    columns: ['rank', 'username', 'name', 'verified', 'private', 'url', 'avatar_url'],
    browser: true,
    navigateBefore: false,
    func: async (page, kwargs) => {
        await page.goto('https://www.instagram.com/');
        return runInstagramRead(page, `(async () => {
  const query = ${JSON.stringify(kwargs.query)};
  const limit = ${JSON.stringify(kwargs.limit)};
  ${readInstagramJsonJs()}
  // web/search/topsearch/ now returns 404 HTML for web sessions; this is the
  // account search the web client itself calls. Its users are flat objects.
  const res = await fetch(
    'https://www.instagram.com/api/v1/fbsearch/account_serp/?query=' + encodeURIComponent(query),
    {
      credentials: 'include',
      headers: { 'X-IG-App-ID': '936619743392459' }
    }
  );
  if (!res.ok) throw new Error('Instagram search failed: HTTP ' + res.status);
  const data = await readInstagramJson(res, 'Instagram search');
  if (!Array.isArray(data.users)) throw new Error('Instagram search returned malformed users');
  const users = data.users.slice(0, limit);
  return users.map((user, i) => ({
    rank: i + 1,
    username: user?.username || '',
    name: user?.full_name || '',
    verified: user?.is_verified ? 'Yes' : 'No',
    private: user?.is_private ? 'Yes' : 'No',
    avatar_url: typeof user?.profile_pic_url === 'string' && user.profile_pic_url.startsWith('https://') ? user.profile_pic_url : '',
    url: 'https://www.instagram.com/' + (user?.username || ''),
  }));
})()
`);
    },
});
