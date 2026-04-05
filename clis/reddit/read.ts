/**
 * Reddit post reader with threaded comment tree.
 *
 * Replaces the original flat read.yaml with recursive comment traversal:
 * - Top-K comments by score at each level
 * - Configurable depth and replies-per-level
 * - Indented output showing conversation threads
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';

cli({
  site: 'reddit',
  name: 'read',
  description: 'Read a Reddit post and its comments',
  domain: 'reddit.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'post-id', required: true, positional: true, help: 'Post ID (e.g. 1abc123) or full URL' },
    { name: 'sort', default: 'best', help: 'Comment sort: best, top, new, controversial, old, qa' },
    { name: 'limit', type: 'int', default: 25, help: 'Number of top-level comments' },
    { name: 'depth', type: 'int', default: 2, help: 'Max reply depth (1=no replies, 2=one level of replies, etc.)' },
    { name: 'replies', type: 'int', default: 5, help: 'Max replies shown per comment at each level (sorted by score)' },
    { name: 'max-length', type: 'int', default: 2000, help: 'Max characters per comment body (min 100)' },
  ],
  columns: ['type', 'author', 'score', 'text'],
  func: async (page, kwargs) => {
    const sort = kwargs.sort ?? 'best';
    const limit = Math.max(1, kwargs.limit ?? 25);
    const maxDepth = Math.max(1, kwargs.depth ?? 2);
    const maxReplies = Math.max(1, kwargs.replies ?? 5);
    const maxLength = Math.max(100, kwargs['max-length'] ?? 2000);

    await page.goto('https://www.reddit.com');

    const data = await page.evaluate(`
      (async function() {
        var postId = ${JSON.stringify(kwargs['post-id'])};
        var urlMatch = postId.match(/comments\\/([a-z0-9]+)/);
        if (urlMatch) postId = urlMatch[1];

        var sort = ${JSON.stringify(sort)};
        var limit = ${limit};
        var maxDepth = ${maxDepth};
        var maxReplies = ${maxReplies};
        var maxLength = ${maxLength};

        // Request more from API than top-level limit to get inline replies
        // depth param tells Reddit how deep to inline replies vs "more" stubs
        var apiLimit = Math.max(limit * 3, 100);
        var res = await fetch(
          '/comments/' + postId + '.json?sort=' + sort + '&limit=' + apiLimit + '&depth=' + (maxDepth + 1) + '&raw_json=1',
          { credentials: 'include' }
        );
        if (!res.ok) return { error: 'Reddit API returned HTTP ' + res.status };

        var data;
        try { data = await res.json(); } catch(e) { return { error: 'Failed to parse response' }; }
        if (!Array.isArray(data) || data.length < 2) return { error: 'Unexpected response format' };

        var results = [];

        // Post
        var post = data[0] && data[0].data && data[0].data.children && data[0].data.children[0] && data[0].data.children[0].data;
        if (post) {
          var body = post.selftext || '';
          if (body.length > maxLength) body = body.slice(0, maxLength) + '\\n... [truncated]';
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
          var d = node.data;
          var body = d.body || '';
          if (body.length > maxLength) body = body.slice(0, maxLength) + '...';

          // Indent prefix: apply to every line so multiline bodies stay aligned
          var indent = '';
          for (var i = 0; i < depth; i++) indent += '  ';
          var prefix = depth === 0 ? '' : indent + '> ';
          var indentedBody = depth === 0
            ? body
            : body.split('\\n').map(function(line) { return prefix + line; }).join('\\n');

          results.push({
            type: depth === 0 ? 'L0' : 'L' + depth,
            author: d.author || '[deleted]',
            score: d.score || 0,
            text: indentedBody,
          });

          // Count all available replies (for accurate "more" count)
          var t1Children = [];
          var moreCount = 0;
          if (d.replies && d.replies.data && d.replies.data.children) {
            var children = d.replies.data.children;
            for (var i = 0; i < children.length; i++) {
              if (children[i].kind === 't1') {
                t1Children.push(children[i]);
              } else if (children[i].kind === 'more') {
                moreCount += children[i].data.count || 0;
              }
            }
          }

          // At depth cutoff: don't recurse, but show all replies as hidden
          if (depth + 1 >= maxDepth) {
            var totalHidden = t1Children.length + moreCount;
            if (totalHidden > 0) {
              var cutoffIndent = '';
              for (var j = 0; j <= depth; j++) cutoffIndent += '  ';
              results.push({
                type: 'L' + (depth + 1),
                author: '',
                score: '',
                text: cutoffIndent + '[+' + totalHidden + ' more replies]',
              });
            }
            return;
          }

          // Sort by score descending, take top N
          t1Children.sort(function(a, b) { return (b.data.score || 0) - (a.data.score || 0); });
          var toProcess = Math.min(t1Children.length, maxReplies);
          for (var i = 0; i < toProcess; i++) {
            walkComment(t1Children[i], depth + 1);
          }

          // Show hidden count (skipped replies + "more" stubs)
          var hidden = t1Children.length - toProcess + moreCount;
          if (hidden > 0) {
            var moreIndent = '';
            for (var j = 0; j <= depth; j++) moreIndent += '  ';
            results.push({
              type: 'L' + (depth + 1),
              author: '',
              score: '',
              text: moreIndent + '[+' + hidden + ' more replies]',
            });
          }
        }

        // Walk top-level comments
        var topLevel = data[1].data.children || [];
        var t1TopLevel = [];
        for (var i = 0; i < topLevel.length; i++) {
          if (topLevel[i].kind === 't1') t1TopLevel.push(topLevel[i]);
        }

        // Top-level are already sorted by Reddit (sort param), take top N
        for (var i = 0; i < Math.min(t1TopLevel.length, limit); i++) {
          walkComment(t1TopLevel[i], 0);
        }

        // Count remaining
        var moreTopLevel = topLevel.filter(function(c) { return c.kind === 'more'; })
          .reduce(function(sum, c) { return sum + (c.data.count || 0); }, 0);
        var hiddenTopLevel = Math.max(0, t1TopLevel.length - limit) + moreTopLevel;
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

    if (!data || typeof data !== 'object') throw new CommandExecutionError('Failed to fetch post data');
    if (!Array.isArray(data) && data.error) throw new CommandExecutionError(data.error);
    if (!Array.isArray(data)) throw new CommandExecutionError('Unexpected response');

    return data;
  },
});
