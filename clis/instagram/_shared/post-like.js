import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

const INSTAGRAM_APP_ID = '936619743392459';
const LIKE_LABELS = ['Like', '赞'];
const UNLIKE_LABELS = ['Unlike', '取消赞'];
const COMMENT_LABELS = ['Comment', '评论'];
const SHARE_LABELS = ['Share', '分享'];

function unwrapEvaluateResult(result) {
    return result && typeof result === 'object' && !Array.isArray(result) && 'data' in result && 'session' in result
        ? result.data
        : result;
}

function labelSelector(labels) {
    return labels.map((label) => `svg[aria-label="${label}"]`).join(', ');
}

function normalizeNumericId(value) {
    const id = typeof value === 'number' ? String(value) : (typeof value === 'string' ? value.trim() : '');
    return /^\d+$/.test(id) ? id : '';
}

function normalizeShortcode(value) {
    const code = typeof value === 'string' ? value.trim() : '';
    return /^[A-Za-z0-9_-]+$/.test(code) ? code : '';
}

export function buildReadPostsJs(username, count) {
    return `(async () => {
  let res;
  try {
    res = await fetch(
      'https://www.instagram.com/api/v1/feed/user/' + encodeURIComponent(${JSON.stringify(username)}) + '/username/?count=' + ${count},
      { credentials: 'include', headers: { 'X-IG-App-ID': '${INSTAGRAM_APP_ID}' } }
    );
  } catch (error) {
    return { errorKind: 'fetch', message: error instanceof Error ? error.message : String(error) };
  }
  if (!res.ok) return { error: res.status };
  let data;
  try {
    data = await res.json();
  } catch {
    return { errorKind: 'invalid-json' };
  }
  const items = Array.isArray(data?.items) ? data.items : null;
  return {
    ownerId: data?.user?.pk ?? data?.user?.id,
    items: items && items.map((item) => ({
      code: item?.code,
      pk: item?.pk ?? item?.id,
      caption: typeof item?.caption?.text === 'string' ? item.caption.text.substring(0, 60) : '',
      liked: item?.has_liked,
    })),
  };
})()`;
}

// Comment rows repeat the like labels on 16px icons, so only a 24px icon in a
// sparse action bar with comment/share siblings is the post control (#2241).
function buildFindControlJs(body) {
    return `(() => {
  const isActionBar = (icon) => {
    const bar = icon.closest('section, div[role="group"]');
    if (!bar || bar.querySelectorAll('svg[aria-label]').length > 8) return false;
    const hasComment = !!bar.querySelector('${labelSelector(COMMENT_LABELS)}');
    const hasShare = !!bar.querySelector('${labelSelector(SHARE_LABELS)}');
    return hasComment || hasShare;
  };
  const control = Array.from(document.querySelectorAll('${labelSelector([...LIKE_LABELS, ...UNLIKE_LABELS])}'))
    .find((icon) => Math.round(icon.getBoundingClientRect().width) >= 24 && isActionBar(icon)) || null;
  const liked = control ? ${JSON.stringify(UNLIKE_LABELS)}.includes(control.getAttribute('aria-label')) : null;
${body}
})()`;
}

export function buildToggleLikeJs(shouldLike) {
    return buildFindControlJs(`  if (!control) return { found: false };
  if (liked === ${shouldLike}) return { found: true, already: true };
  const button = control.closest('div[role="button"], button');
  if (!button) return { found: false };
  button.click();
  return { found: true, already: false };`);
}

export function buildReadLikeStateJs(shouldLike) {
    return buildFindControlJs(`  return liked === ${shouldLike};`);
}

function readPostsError(feed, command, username) {
    if (feed?.error === 401 || feed?.error === 403) {
        return new AuthRequiredError('www.instagram.com', `Instagram requires login to read ${username}'s posts`);
    }
    if (feed?.error === 404) {
        return new EmptyResultError(command, `No Instagram user named ${username}.`);
    }
    if (feed?.error) {
        return new CommandExecutionError(`Instagram returned HTTP ${feed.error} for ${username}'s posts`, 'Verify you are logged in to Instagram.');
    }
    if (feed?.errorKind === 'fetch') {
        return new CommandExecutionError(`Instagram post feed request failed for ${username}: ${feed.message || 'fetch failed'}`);
    }
    if (feed?.errorKind === 'invalid-json') {
        return new CommandExecutionError(`Instagram post feed returned invalid JSON for ${username}`);
    }
    return null;
}

function normalizeFeedSnapshot(feed, command, username) {
    const error = readPostsError(feed, command, username);
    if (error) throw error;
    if (!feed || typeof feed !== 'object' || Array.isArray(feed)) {
        throw new CommandExecutionError(`Instagram post feed returned malformed payload for ${username}`);
    }
    const ownerId = normalizeNumericId(feed.ownerId);
    if (!ownerId) {
        throw new CommandExecutionError(`Instagram post feed returned no valid owner id for ${username}`);
    }
    if (!Array.isArray(feed.items)) {
        throw new CommandExecutionError(`Instagram post feed returned malformed items for ${username}`);
    }
    const posts = feed.items.map((item) => {
        if (!item || typeof item !== 'object') {
            throw new CommandExecutionError(`Instagram post feed returned malformed post row for ${username}`);
        }
        const code = normalizeShortcode(item.code);
        const pk = normalizeNumericId(item.pk);
        if (!code || !pk || typeof item.liked !== 'boolean') {
            throw new CommandExecutionError(`Instagram post feed returned malformed post row for ${username}`);
        }
        return {
            code,
            pk,
            caption: typeof item.caption === 'string' ? item.caption : '',
            liked: item.liked,
        };
    });
    return { ownerId, posts };
}

async function readPostSnapshot(page, username, index, command) {
    const feed = unwrapEvaluateResult(await page.evaluate(buildReadPostsJs(username, index)));
    return normalizeFeedSnapshot(feed, command, username);
}

function pickPost(snapshot, username, index, command) {
    const post = snapshot.posts[index - 1];
    if (!post) {
        throw new EmptyResultError(command, snapshot.posts.length === 0
            ? `No visible posts for ${username}; check the username and whether the account is private.`
            : `Post index ${index} not found; ${username} has ${snapshot.posts.length} recent posts.`);
    }
    return post;
}

async function confirmPersistedState(page, username, index, command, expectedPost, shouldLike) {
    const confirmed = pickPost(await readPostSnapshot(page, username, index, command), username, index, command);
    if (confirmed.code !== expectedPost.code || confirmed.pk !== expectedPost.pk) {
        throw new CommandExecutionError(
            `Instagram post feed no longer shows the expected post ${expectedPost.code} at index ${index}`,
            'The profile feed may have re-rendered or changed order; retry after checking the post in the browser.',
        );
    }
    if (confirmed.liked !== shouldLike) {
        throw new CommandExecutionError(
            `Instagram did not persist the ${shouldLike ? 'like' : 'unlike'} on ${expectedPost.code}`,
            'The action may have been rejected. Retry later, or check the post in the browser.',
        );
    }
    return confirmed;
}

export async function setInstagramPostLike(page, kwargs, shouldLike) {
    const username = String(kwargs.username || '').trim();
    const index = kwargs.index;
    const command = shouldLike ? 'instagram like' : 'instagram unlike';
    if (!username) {
        throw new ArgumentError('username is required');
    }
    if (!Number.isInteger(index) || index < 1) {
        throw new ArgumentError('--index must be a positive integer', 'e.g. --index 2 for the second most recent post');
    }

    const snapshot = await readPostSnapshot(page, username, index, command);
    const post = pickPost(snapshot, username, index, command);
    const label = post.caption || `(post #${index})`;
    const settled = [{ status: shouldLike ? 'Already liked' : 'Already unliked', user: username, post: label }];
    if (post.liked === shouldLike) return settled;

    await page.goto(`https://www.instagram.com/p/${post.code}/`, { settleMs: 2000 });
    let click = null;
    for (let attempt = 0; attempt < 5 && !click?.found; attempt += 1) {
        if (attempt > 0) await page.sleep(1);
        click = unwrapEvaluateResult(await page.evaluate(buildToggleLikeJs(shouldLike)));
    }
    if (!click?.found) {
        throw new CommandExecutionError(
            `Could not find the like control on ${post.code}`,
            'Open the post in the browser and check whether Instagram is asking you to log in, or set the interface language to English.',
        );
    }
    if (click.already) {
        await confirmPersistedState(page, username, index, command, post, shouldLike);
        return settled;
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
        await page.sleep(1);
        if (unwrapEvaluateResult(await page.evaluate(buildReadLikeStateJs(shouldLike))) !== true) continue;
        // A rejected action reverts the icon shortly after the optimistic flip.
        await page.sleep(2);
        if (unwrapEvaluateResult(await page.evaluate(buildReadLikeStateJs(shouldLike))) === true) {
            await confirmPersistedState(page, username, index, command, post, shouldLike);
            return [{ status: shouldLike ? 'Liked' : 'Unliked', user: username, post: label }];
        }
        break;
    }
    throw new CommandExecutionError(
        `Instagram did not keep the ${shouldLike ? 'like' : 'unlike'} on ${post.code}`,
        'The action may have been rejected. Retry later, or check the post in the browser.',
    );
}
