// opts: { method, path, body?, serverScoped, serverIdOverride? }
//   method      'GET' | 'POST' | 'DELETE' | 'PATCH'
//   serverScoped  when true, resolve slug→id and send X-Server-Id
//   serverIdOverride  if set, skip the localStorage slug lookup for this call
export function buildFetchSnippet(opts) {
  const method = JSON.stringify(opts.method);
  const path = JSON.stringify('/api' + opts.path);
  const bodyJson = opts.body === undefined ? 'undefined' : JSON.stringify(JSON.stringify(opts.body));
  const serverScoped = opts.serverScoped ? 'true' : 'false';
  const overrideSid = opts.serverIdOverride ? JSON.stringify(opts.serverIdOverride) : 'null';

  return `
    const token = localStorage.getItem('slock_access_token');
    if (!token) return { kind: 'auth', detail: 'no access token in localStorage' };
    let sid = ${overrideSid};
    if (${serverScoped} && !sid) {
      const slug = localStorage.getItem('slock_last_server_slug');
      if (!slug) return { kind: 'no-server', detail: 'localStorage.slock_last_server_slug is empty; run \`slock server-use <slug>\`' };
      const sres = await fetch('/api/servers/', {
        method: 'GET', credentials: 'include',
        headers: { authorization: 'Bearer ' + token, accept: 'application/json' },
      });
      if (sres.status === 401) return { kind: 'auth', detail: '/servers/ returned 401' };
      if (!sres.ok) return { kind: 'http', status: sres.status, where: '/servers/' };
      const slist = await sres.json();
      const m = (Array.isArray(slist) ? slist : []).find((s) => s && s.slug === slug);
      if (!m) return { kind: 'no-server', detail: 'slug "' + slug + '" not in /servers/ — refresh in browser?' };
      sid = m.id;
    }
    const headers = {
      authorization: 'Bearer ' + token,
      accept: 'application/json',
      'content-type': 'application/json',
    };
    if (sid) headers['x-server-id'] = sid;
    const res = await fetch(${path}, {
      method: ${method}, credentials: 'include', headers,
      body: ${bodyJson},
    });
    if (res.status === 401) return { kind: 'auth', detail: ${path} + ' returned 401' };
    if (!res.ok) return { kind: 'http', status: res.status, where: ${path} };
    const data = await res.json().catch(() => ({}));
    return { kind: 'ok', rows: data };
  `;
}
