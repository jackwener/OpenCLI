import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
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
});
