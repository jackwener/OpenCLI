import type { IPage } from '@jackwener/opencli/types';

export interface SlockContext {
  token: string;
  server: { id: string; slug: string; name: string };
  h: Record<string, string>;
}

export interface SlockError {
  error: string;
  help: string;
}

/**
 * Resolve token + workspace context from localStorage.
 * Returns SlockError if not logged in or no workspaces found.
 */
export async function getSlockContext(
  page: IPage,
  slug: string | null,
): Promise<SlockContext | SlockError> {
  return page.evaluate(`(async () => {
    const token = localStorage.getItem('slock_access_token');
    if (!token) return { error: 'Not logged in', help: 'Open https://app.slock.ai and log in, then retry' };
    const slug = ${JSON.stringify(slug)} || localStorage.getItem('slock_last_server_slug');
    const servers = await fetch('https://api.slock.ai/api/servers', {
      headers: { 'Authorization': 'Bearer ' + token }
    }).then(r => r.json());
    if (!Array.isArray(servers) || !servers.length) {
      return { error: 'No workspaces found', help: 'Log in to https://app.slock.ai first' };
    }
    const server = servers.find(s => s.slug === slug) || servers[0];
    return { token, server, h: { 'Authorization': 'Bearer ' + token, 'X-Server-Id': server.id } };
  })()`);
}

/**
 * Resolve channel name or UUID to a channel ID.
 * Accepts plain name ("general"), "#general", or UUID directly.
 * Returns SlockError if channel not found.
 */
export async function resolveChannelId(
  page: IPage,
  channelInput: string,
  h: Record<string, string>,
): Promise<string | SlockError> {
  // UUID — pass through directly, skip the API call
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(channelInput)) {
    return channelInput;
  }
  return page.evaluate(`(async () => {
    const h = ${JSON.stringify(h)};
    const channels = await fetch('https://api.slock.ai/api/channels', { headers: h }).then(r => r.json());
    const name = ${JSON.stringify(channelInput.replace(/^#/, ''))};
    const ch = channels.find(c => c.name === name);
    if (!ch) return { error: 'Channel not found: ' + ${JSON.stringify(channelInput)}, help: 'Run \`opencli slock channels\` to see available channels' };
    return ch.id;
  })()`);
}
