// Shared helper: returns { token, serverId } for the given server slug
// Usage: await page.evaluate(`(${slockContext})(${JSON.stringify(slug)})`)
export const slockContext = `async (slug) => {
  const token = localStorage.getItem('slock_access_token');
  const lastSlug = slug || localStorage.getItem('slock_last_server_slug');
  const r = await fetch('https://api.slock.ai/api/servers', {
    headers: { 'Authorization': 'Bearer ' + token }
  });
  const servers = await r.json();
  const server = servers.find(s => s.slug === lastSlug) || servers[0];
  return { token, serverId: server?.id, slug: server?.slug };
}`;
