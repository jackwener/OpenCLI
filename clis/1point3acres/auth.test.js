import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { IDENTITY_PROBE_JS } from './auth.js';

function runIdentityProbe(html, url = 'https://www.1point3acres.com/bbs/') {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
  return dom.window.eval(IDENTITY_PROBE_JS);
}

describe('1point3acres auth identity probe', () => {
  it('detects the current Discuz user-panel identity link', () => {
    const result = runIdentityProbe(`
      <div id="um">
        <a href="space-uid-123456.html" title="访问我的空间">test_user</a>
      </div>
    `);

    expect(result).toEqual({ ok: true, user_id: '123456', username: 'test_user' });
  });

  it('keeps legacy identity selectors as fallbacks', () => {
    const result = runIdentityProbe(`
      <div id="um">
        <div class="vwmy"><h4><a href="home.php?mod=space&uid=42">legacy_user</a></h4></div>
      </div>
    `);

    expect(result).toEqual({ ok: true, user_id: '42', username: 'legacy_user' });
  });

  it('does not report a successful blank identity when only logged-in menu ids render', () => {
    const result = runIdentityProbe('<div id="g_upmine"></div><div id="extcreditmenu"></div>');

    expect(result).toMatchObject({
      kind: 'shape',
      detail: '1point3acres bbs rendered logged-in menus but no identity link',
    });
  });

  it('treats an anonymous login link as auth required', () => {
    const result = runIdentityProbe('<a href="https://auth.1point3acres.com/login">登录</a>');

    expect(result).toMatchObject({ kind: 'auth' });
  });

  it('reads the uid from the avatar path on the redesigned UI', () => {
    const result = runIdentityProbe(
      '<img src="https://avatar.1p3a.com/000/29/99/38_avatar_middle.jpg?m=1">',
      'https://www.1point3acres.com/home',
    );

    expect(result).toEqual({ ok: true, user_id: '299938', username: '' });
  });

  it('ignores a lookalike avatar URL served from another host', () => {
    const result = runIdentityProbe(
      '<div id="__NEXT_DATA__"></div>'
      + '<img src="https://evil.example.com/000/77/77/77_avatar_middle.jpg?from=avatar.1p3a.com">',
      'https://www.1point3acres.com/home',
    );

    expect(result).toMatchObject({ kind: 'shape' });
  });

  it('resolves the uid on the redesigned route even without the Next marker', () => {
    const result = runIdentityProbe(
      '<img src="https://avatar.1p3a.com/000/29/99/38_avatar_middle.jpg">',
      'https://www.1point3acres.com/home',
    );

    expect(result).toMatchObject({ ok: true, user_id: '299938' });
  });

  it('stays anonymous when a page with no signed-in surface happens to show an avatar', () => {
    const result = runIdentityProbe(
      '<a href="https://auth.1point3acres.com/login">Sign in</a>'
      + '<img src="https://avatar.1p3a.com/000/77/77/77_avatar_small.jpg">',
    );

    expect(result).toMatchObject({ kind: 'auth' });
  });

  it('refuses to guess when the page carries more than one member avatar', () => {
    const result = runIdentityProbe(
      '<img src="https://avatar.1p3a.com/000/29/99/38_avatar_middle.jpg">'
      + '<img src="https://avatar.1p3a.com/000/11/22/33_avatar_middle.jpg">',
      'https://www.1point3acres.com/home',
    );

    expect(result).toMatchObject({ kind: 'shape' });
  });

  it('ignores the placeholder avatar when resolving the uid', () => {
    const result = runIdentityProbe(
      '<img src="https://avatar.1p3a.com/000/00/00/00_avatar_middle.jpg">'
      + '<img src="https://avatar.1p3a.com/000/29/99/38_avatar_middle.jpg">',
      'https://www.1point3acres.com/home',
    );

    expect(result).toMatchObject({ ok: true, user_id: '299938' });
  });

  it('reports a shape failure, not auth, when the redesigned UI hides the identity', () => {
    const result = runIdentityProbe(
      '<div id="__NEXT_DATA__"></div>',
      'https://www.1point3acres.com/home',
    );

    expect(result).toMatchObject({
      kind: 'shape',
      detail: '1point3acres served the redesigned UI with no recognizable identity',
    });
  });
});

describe('1point3acres whoami navigation', () => {
  function pageMock(probe) {
    return {
      getCookies: vi.fn().mockResolvedValue([{ name: 'xxx_auth', value: 'set' }]),
      goto: vi.fn().mockResolvedValue(undefined),
      wait: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue(probe),
    };
  }

  it('reads identity from a Discuz page that leaves the saved UI preference alone', async () => {
    const page = pageMock({ ok: true, user_id: '299938', username: 'someone' });

    await expect(getRegistry().get('1point3acres/whoami').func(page, {})).resolves.toMatchObject({
      logged_in: true,
      user_id: '299938',
    });
    expect(page.goto).toHaveBeenCalledWith('https://www.1point3acres.com/bbs/home.php?mod=space');
    expect(page.goto.mock.calls[0][0]).not.toContain('forum_ui');
  });

  it('surfaces an unresolved identity as a command failure, not as a logged-out session', async () => {
    const page = pageMock({ kind: 'shape', detail: '1point3acres served the redesigned UI with no recognizable identity' });

    await expect(getRegistry().get('1point3acres/whoami').func(page, {})).rejects.toMatchObject({
      code: 'COMMAND_EXEC',
    });
  });
});
