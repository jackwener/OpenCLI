import { cli } from '@jackwener/opencli/registry';
cli({
    site: 'facebook',
    name: 'feed',
    access: 'read',
    description: 'Get your Facebook news feed',
    domain: 'www.facebook.com',
    args: [
        { name: 'limit', type: 'int', default: 10, help: 'Number of posts' },
    ],
    columns: ['index', 'author', 'content', 'likes', 'comments', 'shares'],
    pipeline: [
        { navigate: { url: 'https://www.facebook.com/', settleMs: 4000 } },
        { evaluate: `(() => {
  const limit = \${{ args.limit }};

  // ── Primary extraction via [role="article"] ──────────────────────────
  const articleNodes = document.querySelectorAll('[role="article"]');
  const primaryPosts = Array.from(articleNodes)
    .filter(el => {
      const text = el.textContent.trim();
      return text.length > 30 &&
        !text.startsWith('可能认识') &&
        !text.startsWith('People you may know') &&
        !text.startsWith('People You May Know');
    });

  // ── Fallback extraction via action buttons ────────────────────────────
  // Facebook periodically restructures its DOM so [role="article"] nodes
  // exist but have empty textContent. When that happens we locate post
  // boundaries via the Like/Comment action buttons, then walk up the DOM
  // to the nearest ancestor that contains meaningful text.
  function fallbackExtract() {
    const main = document.querySelector('[role="main"]');
    if (!main) return null;

    const likeSelectors = [
      '[aria-label="Like"]', '[aria-label="赞"]',
      '[aria-label="Comment"]', '[aria-label="评论"]',
    ];
    const actionButtons = Array.from(
      main.querySelectorAll(likeSelectors.join(','))
    );

    const seen = new WeakSet();
    const containers = [];
    for (const btn of actionButtons) {
      let node = btn.parentElement;
      let found = null;
      for (let depth = 0; depth < 20 && node; depth++, node = node.parentElement) {
        if (node.textContent.trim().length >= 80) { found = node; break; }
      }
      if (!found || seen.has(found)) continue;
      seen.add(found);
      containers.push(found);
    }
    return containers.length ? containers : null;
  }

  // ── Extract fields from a post container ─────────────────────────────
  function extractPost(el, i) {
    // Try progressively broader selectors: heading links → role=link → any profile link → first substantial link
    const authorLink =
      el.querySelector('h2 a, h3 a, h4 a, strong a') ||
      el.querySelector('a[href*="/"][role="link"]') ||
      el.querySelector('a[href*="facebook.com/"]') ||
      Array.from(el.querySelectorAll('a[href]')).find(a => {
        const t = a.textContent.trim();
        return t.length > 2 && t.length < 60 && !/^(like|comment|share|follow|\\d)/i.test(t);
      });
    // Fallback for sponsored posts where the advertiser name is not in a link
    const author = (authorLink ? authorLink.textContent.trim() : '') ||
      (() => {
        const short = Array.from(el.querySelectorAll('[dir="auto"]'))
          .map(s => s.textContent.trim())
          .find(t => t.length > 2 && t.length <= 60 && !t.startsWith('#'));
        return short || '';
      })();

    const seen = new Set();
    const dirAutos = Array.from(el.querySelectorAll('[dir="auto"]'))
      .map(s => s.textContent.trim())
      .filter(t => t.length > 10 && t.length < 600 && !seen.has(t) && seen.add(t));
    const content = dirAutos.join(' ');

    const allText = el.textContent;
    const likesMatch = allText.match(/所有心情：([\\d,.\\s]*[\\d万亿KMk]+)/) ||
                       allText.match(/All:\\s*([\\d,.KMk]+)/) ||
                       allText.match(/([\\d,.KMk]+)\\s*(?:likes?|reactions?)/i);
    const commentsMatch = allText.match(/([\\d,.]+\\s*[万亿]?)\\s*条评论/) ||
                          allText.match(/([\\d,.KMk]+)\\s*comments?/i);
    const sharesMatch = allText.match(/([\\d,.]+\\s*[万亿]?)\\s*次分享/) ||
                        allText.match(/([\\d,.KMk]+)\\s*shares?/i);

    return {
      index: i + 1,
      author: author.substring(0, 50),
      content: content.replace(/\\n/g, ' ').substring(0, 120),
      likes: likesMatch ? likesMatch[1] : '-',
      comments: commentsMatch ? commentsMatch[1] : '-',
      shares: sharesMatch ? sharesMatch[1] : '-',
    };
  }

  // ── Route: primary alone if sufficient, else supplement with fallback ──
  const isNotSuggestion = el => {
    const t = el.textContent.trim();
    return !t.startsWith('可能认识') && !t.startsWith('People you may know') && !t.startsWith('People You May Know');
  };

  if (primaryPosts.length >= limit) {
    return primaryPosts.slice(0, limit).map((el, i) => extractPost(el, i));
  }

  const fallbackContainers = fallbackExtract();
  const fallbackPosts = fallbackContainers ? fallbackContainers.filter(isNotSuggestion) : [];

  if (primaryPosts.length > 0 || fallbackPosts.length > 0) {
    const primarySet = new WeakSet(primaryPosts);
    const extra = fallbackPosts.filter(el => !primarySet.has(el));
    const combined = [...primaryPosts, ...extra];
    // Deduplicate nested containers of the same post: same-post ancestors
    // share all [dir="auto"] blocks, so joining them gives a stable signature.
    // Different posts by the same author differ in body text even if they
    // share an author-name prefix, so they won't collide here.
    const seenContent = new Set();
    const deduped = combined.filter(el => {
      const key = Array.from(el.querySelectorAll('[dir="auto"]'))
        .map(s => s.textContent.trim()).filter(t => t.length > 5)
        .join('|').substring(0, 200);
      if (!key || seenContent.has(key)) return false;
      seenContent.add(key);
      return true;
    });
    return deduped.slice(0, limit).map((el, i) => extractPost(el, i));
  }

  // ── Diagnostic when both paths return nothing ─────────────────────────
  const mainEl = document.querySelector('[role="main"]');
  const articleCount = articleNodes.length;
  const mainLen = mainEl ? mainEl.textContent.trim().length : 0;
  throw new Error(
    'facebook feed: no posts found. ' +
    'article nodes=' + articleCount + ' (all empty text), ' +
    'main textLength=' + mainLen + '. ' +
    'The page may not be fully loaded or Facebook DOM changed again.'
  );
})()
` },
    ],
});
