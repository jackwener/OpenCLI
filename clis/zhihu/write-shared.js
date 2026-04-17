import { readFile, stat } from 'node:fs/promises';
import { CliError } from '@jackwener/opencli/errors';
const RESULT_ROW_RESERVED_KEYS = new Set(['status', 'outcome', 'message', 'target_type', 'target']);
const NAV_SCOPE_SELECTOR = 'header, nav, [role="banner"], [role="navigation"]';
const PROFILE_LINK_SELECTOR = 'a[href^="/people/"]';
const AVATAR_SELECTOR = 'img, [class*="Avatar"], [data-testid*="avatar" i], [aria-label*="头像"]';
const SELF_LABEL_TOKENS = ['我', '我的', '个人主页'];
const EXPLICIT_IDENTITY_META_TOKEN_GROUPS = [
    ['self'],
    ['current', 'user'],
    ['account', 'profile'],
    ['my', 'profile'],
    ['my', 'account'],
];
const IN_PAGE_EXPLICIT_IDENTITY_META_TOKEN_GROUPS = JSON.stringify(EXPLICIT_IDENTITY_META_TOKEN_GROUPS);
function defaultFileReaderDeps() {
    return {
        readFile,
        stat: (path) => stat(path),
        decodeUtf8: (raw) => new TextDecoder('utf-8', { fatal: true }).decode(raw),
    };
}
function hasExplicitIdentityLabel(text) {
    const normalized = text.toLowerCase();
    return SELF_LABEL_TOKENS.some((token) => text.includes(token)) || normalized.includes('my profile') || normalized.includes('my account');
}
function tokenizeIdentityMeta(text) {
    return text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean);
}
function hasExplicitIdentityMeta(text) {
    const tokens = new Set(tokenizeIdentityMeta(text));
    return EXPLICIT_IDENTITY_META_TOKEN_GROUPS.some((group) => group.every((token) => tokens.has(token)));
}
function isIdentityRootLike(value) {
    return typeof value === 'object' && value !== null && 'querySelectorAll' in value
        && typeof value.querySelectorAll === 'function';
}
function isIdentityNodeLike(value) {
    return typeof value === 'object' && value !== null
        && 'getAttribute' in value
        && 'querySelector' in value
        && typeof value.getAttribute === 'function'
        && typeof value.querySelector === 'function';
}
function resolveSlugFromState(state) {
    const slugFromState = state?.topstory?.me?.slug
        || state?.me?.slug
        || state?.initialState?.me?.slug;
    return typeof slugFromState === 'string' && slugFromState ? slugFromState : null;
}
function getSlugFromIdentityLink(node, allowAvatarOnly) {
    const href = node.getAttribute('href') || '';
    const match = href.match(/^\/people\/([A-Za-z0-9_-]+)/);
    if (!match)
        return null;
    const aria = node.getAttribute('aria-label') || '';
    const title = node.getAttribute('title') || '';
    const testid = node.getAttribute('data-testid') || '';
    const className = node.getAttribute('class') || '';
    const rel = node.getAttribute('rel') || '';
    const identityLabel = `${aria} ${title} ${node.textContent || ''}`;
    const identityMeta = `${testid} ${className} ${rel}`;
    const hasAvatar = Boolean(node.querySelector(AVATAR_SELECTOR));
    const isExplicitIdentityLabel = hasExplicitIdentityLabel(identityLabel);
    const isExplicitIdentityMeta = hasExplicitIdentityMeta(identityMeta);
    if (isExplicitIdentityLabel || isExplicitIdentityMeta)
        return match[1];
    if (allowAvatarOnly && hasAvatar)
        return match[1];
    return null;
}
function findCurrentUserSlugFromRoots(roots, allowAvatarOnly) {
    for (const root of roots) {
        for (const node of Array.from(root.querySelectorAll(PROFILE_LINK_SELECTOR)).filter(isIdentityNodeLike)) {
            const slug = getSlugFromIdentityLink(node, allowAvatarOnly);
            if (slug)
                return slug;
        }
    }
    return null;
}
export function resolveCurrentUserSlugFromDom(state, documentRoot) {
    const slugFromState = resolveSlugFromState(state);
    if (slugFromState)
        return slugFromState;
    const navScopes = Array.from(documentRoot.querySelectorAll(NAV_SCOPE_SELECTOR)).filter(isIdentityRootLike);
    return findCurrentUserSlugFromRoots(navScopes, true) || findCurrentUserSlugFromRoots([documentRoot], false);
}
export function requireExecute(kwargs) {
    if (!kwargs.execute) {
        throw new CliError('INVALID_INPUT', 'This Zhihu write command requires --execute');
    }
}
export async function resolvePayload(kwargs, deps = defaultFileReaderDeps()) {
    const text = typeof kwargs.text === 'string' ? kwargs.text : undefined;
    const file = typeof kwargs.file === 'string' ? kwargs.file : undefined;
    if (text && file) {
        throw new CliError('INVALID_INPUT', 'Use either <text> or --file, not both');
    }
    let resolved = text ?? '';
    if (file) {
        let fileStat;
        try {
            fileStat = await deps.stat(file);
        }
        catch {
            throw new CliError('INVALID_INPUT', `File not found: ${file}`);
        }
        if (!fileStat.isFile()) {
            throw new CliError('INVALID_INPUT', `File must be a readable text file: ${file}`);
        }
        let raw;
        try {
            raw = await deps.readFile(file);
        }
        catch {
            throw new CliError('INVALID_INPUT', `File could not be read: ${file}`);
        }
        try {
            resolved = deps.decodeUtf8(raw);
        }
        catch {
            throw new CliError('INVALID_INPUT', `File could not be decoded as UTF-8 text: ${file}`);
        }
    }
    if (!resolved.trim()) {
        throw new CliError('INVALID_INPUT', 'Payload cannot be empty or whitespace only');
    }
    return resolved;
}
function buildResolveCurrentUserIdentityJs() {
    return `(() => {
    const selfLabelTokens = ${JSON.stringify(SELF_LABEL_TOKENS)};
    const explicitIdentityMetaTokenGroups = ${IN_PAGE_EXPLICIT_IDENTITY_META_TOKEN_GROUPS};
    const navScopeSelector = ${JSON.stringify(NAV_SCOPE_SELECTOR)};
    const profileLinkSelector = ${JSON.stringify(PROFILE_LINK_SELECTOR)};
    const avatarSelector = ${JSON.stringify(AVATAR_SELECTOR)};

    const hasExplicitIdentityLabel = (text) => {
      const normalized = String(text || '').toLowerCase();
      return selfLabelTokens.some((token) => String(text || '').includes(token))
        || normalized.includes('my profile')
        || normalized.includes('my account');
    };

    const tokenizeIdentityMeta = (text) => String(text || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean);

    const hasExplicitIdentityMeta = (text) => {
      const tokens = new Set(tokenizeIdentityMeta(text));
      return explicitIdentityMetaTokenGroups.some((group) => group.every((token) => tokens.has(token)));
    };

    const getSlugFromIdentityLink = (node, allowAvatarOnly) => {
      const href = node.getAttribute('href') || '';
      const match = href.match(/^\\/people\\/([A-Za-z0-9_-]+)/);
      if (!match) return null;

      const aria = node.getAttribute('aria-label') || '';
      const title = node.getAttribute('title') || '';
      const testid = node.getAttribute('data-testid') || '';
      const className = node.getAttribute('class') || '';
      const rel = node.getAttribute('rel') || '';
      const identityLabel = \`\${aria} \${title} \${node.textContent || ''}\`;
      const identityMeta = \`\${testid} \${className} \${rel}\`;
      const hasAvatar = Boolean(node.querySelector(avatarSelector));

      if (hasExplicitIdentityLabel(identityLabel) || hasExplicitIdentityMeta(identityMeta)) return match[1];
      if (allowAvatarOnly && hasAvatar) return match[1];
      return null;
    };

    const findCurrentUserSlugFromRoots = (roots, allowAvatarOnly) => {
      for (const root of roots) {
        for (const node of Array.from(root.querySelectorAll(profileLinkSelector))) {
          const slug = getSlugFromIdentityLink(node, allowAvatarOnly);
          if (slug) return slug;
        }
      }
      return null;
    };

    const scopedGlobal = globalThis;
    const state = scopedGlobal.__INITIAL_STATE__ || (scopedGlobal.window && scopedGlobal.window.__INITIAL_STATE__) || null;
    const slugFromState = state && (state.topstory && state.topstory.me && state.topstory.me.slug)
      || (state && state.me && state.me.slug)
      || (state && state.initialState && state.initialState.me && state.initialState.me.slug);
    if (typeof slugFromState === 'string' && slugFromState) return { slug: slugFromState };

    const navScopes = Array.from(document.querySelectorAll(navScopeSelector));
    const slug = findCurrentUserSlugFromRoots(navScopes, true) || findCurrentUserSlugFromRoots([document], false);
    return slug ? { slug } : null;
  })()`;
}
export async function resolveCurrentUserIdentity(page) {
    const identity = await page.evaluate(buildResolveCurrentUserIdentityJs());
    if (!identity?.slug) {
        throw new CliError('ACTION_NOT_AVAILABLE', 'Could not resolve the logged-in Zhihu user identity before write');
    }
    return identity.slug;
}
export function buildResultRow(message, targetType, target, outcome, extra = {}) {
    for (const key of Object.keys(extra)) {
        if (RESULT_ROW_RESERVED_KEYS.has(key)) {
            throw new CliError('INVALID_INPUT', `Result extra field cannot overwrite reserved key: ${key}`);
        }
    }
    return [{ status: 'success', outcome, message, target_type: targetType, target, ...extra }];
}
export const __test__ = {
    requireExecute,
    resolvePayload,
    resolveCurrentUserIdentity,
    resolveCurrentUserSlugFromDom,
    buildResultRow,
};
