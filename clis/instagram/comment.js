import { cli } from '@jackwener/opencli/registry';
cli({
    site: 'instagram',
    name: 'comment',
    access: 'write',
    description: 'Comment on an Instagram post',
    domain: 'www.instagram.com',
    args: [
        {
            name: 'username',
            required: true,
            positional: true,
            help: 'Username of the post author',
        },
        { name: 'text', required: true, positional: true, help: 'Comment text' },
        { name: 'index', type: 'int', default: 1, help: 'Post index (1 = most recent)' },
    ],
    columns: ['status', 'user', 'text'],
    pipeline: [
        { navigate: 'https://www.instagram.com' },
        { evaluate: `(async () => {
  const username = \${{ args.username | json }};
  const commentText = \${{ args.text | json }};
  const idx = \${{ args.index }} - 1;
  if (!Number.isInteger(idx) || idx < 0) throw new Error('index must be a positive integer');
  const headers = { 'X-IG-App-ID': '936619743392459' };
  const opts = { credentials: 'include', headers };
  async function readInstagramJson(response, label) {
    try {
      return await response.json();
    } catch {
      throw new Error(label + ' returned invalid JSON');
    }
  }
  function getPostFromFeed(feed, label) {
    if (!feed || typeof feed !== 'object' || !Array.isArray(feed.items)) {
      throw new Error(label + ' returned malformed items payload');
    }
    if (idx >= feed.items.length) throw new Error('Post index ' + (idx + 1) + ' not found');
    const post = feed.items[idx];
    const pkRaw = post?.pk ?? post?.id;
    const pk = typeof pkRaw === 'number' ? String(pkRaw) : (typeof pkRaw === 'string' ? pkRaw.trim() : '');
    if (!/^\\d+$/.test(pk)) throw new Error(label + ' returned malformed post row');
    return { pk };
  }
  function assertOkStatus(payload, label) {
    if (!payload || typeof payload !== 'object' || payload.status !== 'ok') {
      throw new Error(label + ' returned no success evidence');
    }
  }

  // web_profile_info answers HTTP 400 for business accounts; feed-by-username needs no user id. See #2234.
  const r1 = await fetch('https://www.instagram.com/api/v1/feed/user/' + encodeURIComponent(username) + '/username/?count=' + (idx + 1), opts);
  if (!r1.ok) throw new Error(r1.status === 404 ? 'User not found: ' + username : 'HTTP ' + r1.status + ' - make sure you are logged in to Instagram');
  const { pk } = getPostFromFeed(await readInstagramJson(r1, 'Instagram feed-by-username'), 'Instagram feed-by-username');

  const csrf = document.cookie.match(/csrftoken=([^;]+)/)?.[1] || '';
  const r2 = await fetch('https://www.instagram.com/api/v1/web/comments/' + pk + '/add/', {
    method: 'POST', credentials: 'include',
    headers: { ...headers, 'X-CSRFToken': csrf, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'comment_text=' + encodeURIComponent(commentText),
  });
  if (!r2.ok) throw new Error('Failed to comment: HTTP ' + r2.status);
  assertOkStatus(await readInstagramJson(r2, 'Instagram comment'), 'Instagram comment');
  return [{ status: 'Commented', user: username, text: commentText }];
})()
` },
    ],
});
