/**
 * YouTube unsubscribe — unsubscribe from a channel via InnerTube subscription API.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { prepareYoutubeApiPage, SAPISID_HASH_FN, RESOLVE_CHANNEL_HANDLE_FN } from './utils.js';
import { CommandExecutionError, AuthRequiredError } from '@jackwener/opencli/errors';

cli({
    site: 'youtube',
    name: 'unsubscribe',
    access: 'write',
    description: 'Unsubscribe from a YouTube channel',
    domain: 'www.youtube.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'channel', required: true, positional: true, help: 'Channel ID (UCxxxx) or handle (@name)' },
    ],
    columns: ['status', 'message'],
    func: async (page, kwargs) => {
        const channelInput = String(kwargs.channel);
        await prepareYoutubeApiPage(page);
        const result = await page.evaluate(`
      (async () => {
        ${SAPISID_HASH_FN}

        const cfg = window.ytcfg?.data_ || {};
        const apiKey = cfg.INNERTUBE_API_KEY;
        const context = cfg.INNERTUBE_CONTEXT;
        if (!apiKey || !context) return { error: 'config', message: 'YouTube config not found' };

        const authHash = await getSapisidHash('https://www.youtube.com');
        if (!authHash) return { error: 'auth', message: 'Not logged in (SAPISID cookie missing)' };

        ${RESOLVE_CHANNEL_HANDLE_FN}

        let channelId = ${JSON.stringify(channelInput)};
        channelId = await resolveChannelHandle(channelId, apiKey, context);

        if (!channelId.startsWith('UC')) {
          return { error: 'arg', message: 'Could not resolve channel ID from: ' + ${JSON.stringify(channelInput)} };
        }

        const resp = await fetch('/youtubei/v1/subscription/unsubscribe?key=' + apiKey + '&prettyPrint=false', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': authHash,
            'X-Origin': 'https://www.youtube.com',
          },
          body: JSON.stringify({ context, channelIds: [channelId] }),
        });

        if (resp.status === 401 || resp.status === 403) return { error: 'auth', message: 'Not logged in' };
        if (!resp.ok) {
          const body = await resp.json().catch(() => ({}));
          const errStatus = body?.error?.status || '';
          if (errStatus === 'UNAUTHENTICATED') return { error: 'auth', message: 'Not logged in' };
          return { error: 'http', message: 'HTTP ' + resp.status + (errStatus ? ' ' + errStatus : '') };
        }
        return { ok: true, channelId };
      })()
    `);
        if (result?.error === 'auth') {
            throw new AuthRequiredError('www.youtube.com');
        }
        if (result?.error) {
            throw new CommandExecutionError(result.message || 'Failed to unsubscribe');
        }
        return [{ status: 'success', message: 'Unsubscribed from: ' + (result.channelId || channelInput) }];
    },
});
