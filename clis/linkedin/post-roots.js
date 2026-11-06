// Runs inside the browser. Keep this helper self-contained for script injection.
export function locatePostCards(document) {
  const selector = 'article, [role="article"], .feed-shared-update-v2, .occludable-update';
  const scope = document.querySelector('main, [role="main"]') || document.body;
  const visible = node => {
    for (let el = node; el; el = el.parentElement) {
      const style = document.defaultView.getComputedStyle(el);
      if (el.hidden || el.getAttribute('aria-hidden') === 'true' || style.display === 'none' || style.visibility === 'hidden') return false;
    }
    return true;
  };
  const identity = link => {
    try {
      const url = new URL(link.href, document.location.href);
      if (url.protocol !== 'https:' || !/^(?:www\.)?linkedin\.com$/.test(url.hostname) || url.username || url.password) return '';
      const activity = url.pathname.match(/\/feed\/update\/urn:li:activity:(\d+)/) || url.pathname.match(/\/posts\/[^/]*activity-(\d+)/);
      if (activity) return 'activity:' + activity[1];
      return /^\/(?:posts|feed\/update)\/[^/]+/.test(url.pathname) ? url.origin + url.pathname.replace(/\/$/, '') : '';
    } catch { return ''; }
  };
  const linksIn = root => Array.from(root.querySelectorAll('a[href]')).filter(link => identity(link) && visible(link));
  const identitiesIn = root => new Set(linksIn(root).map(identity));
  const cards = Array.from(scope.querySelectorAll(selector)).filter(visible);
  // SDUi activity pages (#2651) render neither legacy card classes nor
  // permalinks; each post is a component keyed by its feed type. A node that
  // wraps two or more such components is the list, not a post.
  const sdui = Array.from(scope.querySelectorAll('[id*="FeedType_CREATOR_PROFILE_ALL_CONTENT_VIEW"], [componentkey*="FeedType_CREATOR_PROFILE_ALL_CONTENT_VIEW"]')).filter(visible);
  for (const node of sdui) {
    if (sdui.filter(other => other !== node && node.contains(other)).length < 2) cards.push(node);
  }
  const links = linksIn(scope).filter(link => !link.closest('nav, aside, [role="navigation"], [role="complementary"]'));
  let unmatchedPermalinks = 0;
  for (const link of links) {
    if (cards.some(card => card.contains(link))) continue;
    let generic = null;
    let root = null;
    for (let node = link.parentElement, depth = 0; node && node !== scope && depth < 12; node = node.parentElement, depth++) {
      if (identitiesIn(node).size !== 1) break;
      const author = node.querySelector('a[href*="/in/"], a[href*="/company/"]');
      if (!author) continue;
      if (node.matches('li, [role="listitem"]')) { root = node; break; }
      const text = node.innerText || node.textContent || '';
      const hasBody = node.querySelector('.update-components-text, .feed-shared-text, [dir="ltr"], p');
      if (!generic && hasBody && /\b\d+\s*(?:s|m|h|d|w|mo|yr|min)\b/i.test(text)) generic = node;
    }
    root ||= generic;
    if (root) cards.push(root);
    else unmatchedPermalinks++;
  }
  // Old markup often nests two recognized card classes around the same post.
  // Prefer the outer card, retaining its complete body and metrics.
  return { cards: cards.filter(card => !cards.some(other => other !== card && other.contains(card))), unmatchedPermalinks };
}
