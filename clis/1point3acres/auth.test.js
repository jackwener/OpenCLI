import { getRegistry } from '@jackwener/opencli/registry';
import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { IDENTITY_PROBE_JS } from './auth.js';

function runIdentityProbe(html, url = 'https://www.1point3acres.com/bbs/') {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
  try { return dom.window.eval(IDENTITY_PROBE_JS); } finally { dom.window.close(); }
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


describe('1point3acres whoami navigation and identity boundaries', () => {
  function pageFor(html, cookies = [{ name: 'discuz_auth', value: 'fixture' }]) {
    const dom = new JSDOM('', { url: 'https://www.1point3acres.com/', runScripts: 'outside-only' });
    const page = {
      getCookies: vi.fn(async () => cookies),
      wait: vi.fn(async () => {}),
      goto: vi.fn(async (url) => {
        dom.reconfigure({ url });
        dom.window.document.body.innerHTML = url === 'https://www.1point3acres.com/bbs/home.php?mod=space' ? html : '<main>SPA home</main>';
      }),
      evaluate: vi.fn(async (script) => dom.window.eval(script)),
    };
    return { dom, page };
  }

  it('reads the current-user panel from the Discuz-native page', async () => {
    const { dom, page } = pageFor('<div id="um"><a title="访问我的空间" href="space-uid-42.html">viewer</a></div>');
    try {
      await expect(getRegistry().get('1point3acres/whoami').func(page, {})).resolves.toMatchObject({ logged_in: true, user_id: '42', username: 'viewer' });
      expect(page.goto).toHaveBeenCalledExactlyOnceWith('https://www.1point3acres.com/bbs/home.php?mod=space');
    } finally { dom.window.close(); }
  });

  it.each([
    '<main>SPA home</main>',
    '<script id="__NEXT_DATA__">{}</script><img src="https://avatar.1p3a.com/000/12/34/56_avatar_middle.jpg">',
  ])('keeps missing self identity unknown even with an auth cookie', async (html) => {
    const { dom, page } = pageFor(html);
    try {
      await expect(getRegistry().get('1point3acres/whoami').func(page, {})).rejects.toMatchObject({ code: 'COMMAND_EXEC' });
    } finally { dom.window.close(); }
  });

  it('still reports an explicit login wall as AUTH_REQUIRED', async () => {
    const { dom, page } = pageFor('<a href="https://auth.1point3acres.com/login">登录</a>');
    try {
      await expect(getRegistry().get('1point3acres/whoami').func(page, {})).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    } finally { dom.window.close(); }
  });

  it('rejects missing auth cookies before navigating', async () => {
    const { dom, page } = pageFor('', []);
    try {
      await expect(getRegistry().get('1point3acres/whoami').func(page, {})).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
      expect(page.goto).not.toHaveBeenCalled();
    } finally { dom.window.close(); }
  });
});
