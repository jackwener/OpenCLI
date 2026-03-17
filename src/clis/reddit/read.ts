/**
 * Reddit post reader with threaded comment tree.
 *
 * Replaces the original flat read.yaml with recursive comment traversal:
 * - Top-K comments by score at each level
 * - Configurable depth and replies-per-level
 * - Indented output showing conversation threads
 */
import { cli, Strategy } from '../../registry.js';

cli({
  site: 'reddit',
  name: 'read',
  description: 'Read a Reddit post and its comments',
  domain: 'reddit.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'post_id', type: 'string', required: true, help: 'Post ID (e.g. 1abc123) or full URL' },
    { name: 'sort', type: 'string', default: 'best', help: 'Comment sort: best, top, new, controversial, old, qa' },
    { name: 'limit', type: 'int', default: 25, help: 'Number of top-level comments' },
    { name: 'depth', type: 'int', default: 2, help: 'Max reply depth (1=no replies, 2=one level of replies, etc.)' },
    { name: 'replies', type: 'int', default: 5, help: 'Max replies shown per comment at each level (sorted by score)' },
    { name: 'max_length', type: 'int', default: 2000, help: 'Max characters per comment body (min 100)' },
  ],
  columns: ['type', 'author', 'score', 'text'],
  func: async (page, kwargs) => {
    if (!page) throw new Error('Requires browser');

    const sort = kwargs.sort ?? 'best';
    const limit = Math.max(1, kwargs.limit ?? 25);
    const maxDepth = Math.max(1, kwargs.depth ?? 2);
    const maxReplies = Math.max(1, kwargs.replies ?? 5);
    const maxLength = Math.max(100, kwargs.max_length ?? 2000);

    await page.goto('https://www.reddit.com');
    await page.wait(3);

    const data = await page.evaluate(`
      (async function() {
        let postId = ${JSON.stringify(kwargs.post_id)};
        const urlMatch = postId.match(/comments\\/([a-z0-9]+)/);
        if (urlMatch) postId = urlMatch[1];

        const sort = ${JSON.stringify(sort)};
        const limit = ${limit};
        const maxDepth = ${maxDepth};
        const maxReplies = ${maxReplies};
        const maxLength = ${maxLength};

        // Request more from API than top-level limit to get inline replies
        // depth param tells Reddit how deep to inline replies vs "more" stubs
        const apiLimit = Math.max(limit * 3, 100);
        const res = await fetch(
          '/comments/' + postId + '.json?sort=' + sort + '&limit=' + apiLimit + '&depth=' + (maxDepth + 1) + '&raw_json=1',
          { credentials: 'include' }
        );
        if (!res.ok) return { error: 'Reddit API returned HTTP ' + res.status };

        let data;
        try { data = await res.json(); } catch(e) { return { error: 'Failed to parse response' }; }
        if (!Array.isArray(data) || data.length < 2) return { error: 'Unexpected response format' };

        const results = [];

        // Post
        const post = data[0] && data[0].data && data[0].data.children && data[0].data.children[0] && data[0].data.children[0].data;
        if (post) {
          let body = post.selftext || '';
          if (body.length > maxLength) body = body.slice(0, maxLength) + '...';
          results.push({
            type: 'POST',
            author: post.author || '[deleted]',
            score: post.score || 0,
            text: post.title + (body ? '\\n\\n' + body : '') + (post.url && !post.is_self ? '\\n' + post.url : ''),
          });
        }

        // Recursive comment walker
        // depth 0 = top-level comments; maxDepth is exclusive,
        // so --depth 1 means top-level only, --depth 2 means one reply level, etc.
        function walkComment(node, depth) {
          if (!node || node.kind !== 't1') return;
          const d = node.data;
          let body = d.body || '';
          if (body.length > maxLength) body = body.slice(0, maxLength) + '...';

          // Indent prefix: apply to every line so multiline bodies stay aligned
          const indent = '  '.repeat(depth);
          const prefix = depth === 0 ? '' : indent + '> ';
          const indentedBody = depth === 0
            ? body
            : body.split('\\n').map(function(line) { return prefix + line; }).join('\\n');

          results.push({
            type: 'L' + depth,
            author: d.author || '[deleted]',
            score: d.score || 0,
            text: indentedBody,
          });

          // Count all available replies (for accurate "more" count)
          const t1Children = [];
          let moreCount = 0;
          if (d.replies && d.replies.data && d.replies.data.children) {
            const children = d.replies.data.children;
            for (let i = 0; i < children.length; i++) {
              if (children[i].kind === 't1') {
                t1Children.push(children[i]);
              } else if (children[i].kind === 'more') {
                moreCount += children[i].data.count || 0;
              }
            }
          }

          // At depth cutoff: don't recurse, but show all replies as hidden
          if (depth + 1 >= maxDepth) {
            const totalHidden = t1Children.length + moreCount;
            if (totalHidden > 0) {
              results.push({
                type: 'L' + (depth + 1),
                author: '',
                score: '',
                text: '  '.repeat(depth + 1) + '[+' + totalHidden + ' more replies]',
              });
            }
            return;
          }

          // Sort by score descending, take top N
          t1Children.sort(function(a, b) { return (b.data.score || 0) - (a.data.score || 0); });
          const toProcess = Math.min(t1Children.length, maxReplies);
          for (let i = 0; i < toProcess; i++) {
            walkComment(t1Children[i], depth + 1);
          }

          // Show hidden count (skipped replies + "more" stubs)
          const hidden = t1Children.length - toProcess + moreCount;
          if (hidden > 0) {
            results.push({
              type: 'L' + (depth + 1),
              author: '',
              score: '',
              text: '  '.repeat(depth + 1) + '[+' + hidden + ' more replies]',
            });
          }
        }

        // Walk top-level comments
        const topLevel = data[1].data.children || [];
        const t1TopLevel = [];
        for (let i = 0; i < topLevel.length; i++) {
          if (topLevel[i].kind === 't1') t1TopLevel.push(topLevel[i]);
        }

        // Top-level are already sorted by Reddit (sort param), take top N
        for (let i = 0; i < Math.min(t1TopLevel.length, limit); i++) {
          walkComment(t1TopLevel[i], 0);
        }

        // Count remaining
        const moreTopLevel = topLevel.filter(function(c) { return c.kind === 'more'; })
          .reduce(function(sum, c) { return sum + (c.data.count || 0); }, 0);
        const hiddenTopLevel = Math.max(0, t1TopLevel.length - limit) + moreTopLevel;
        if (hiddenTopLevel > 0) {
          results.push({
            type: '',
            author: '',
            score: '',
            text: '[+' + hiddenTopLevel + ' more top-level comments]',
          });
        }

        return results;
      })()
    `);

    if (!data || typeof data !== 'object') throw new Error('Failed to fetch post data');
    if (!Array.isArray(data) && data.error) throw new Error(data.error);
    if (!Array.isArray(data)) throw new Error('Unexpected response');

    return data;
  },
});
