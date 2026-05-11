/**
 * YouTube like — like a video via InnerTube like API (requires SAPISIDHASH auth).
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { parseVideoId, prepareYoutubeApiPage, readYoutubeSapisid, SAPISID_HASH_FN } from './utils.js';
import { CommandExecutionError, AuthRequiredError } from '@jackwener/opencli/errors';

cli({
    site: 'youtube',
    name: 'like',
    access: 'write',
    description: 'Like a YouTube video',
    domain: 'www.youtube.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'url', required: true, positional: true, help: 'YouTube video URL or video ID' },
    ],
    columns: ['status', 'message'],
    func: async (page, kwargs) => {
        const videoId = parseVideoId(String(kwargs.url));
        await prepareYoutubeApiPage(page);
        // Read SAPISID directly from the cookie store via CDP — zero document.cookie round-trip
        const sapisid = await readYoutubeSapisid(page);
        if (!sapisid)
            throw new AuthRequiredError('www.youtube.com', 'Not logged in (SAPISID cookie missing)');
        const result = await page.evaluate(`
      (async () => {
        ${SAPISID_HASH_FN}

        const cfg = window.ytcfg?.data_ || {};
        const apiKey = cfg.INNERTUBE_API_KEY;
        const context = cfg.INNERTUBE_CONTEXT;
        if (!apiKey || !context) return { error: 'config', message: 'YouTube config not found' };

        const authHash = await getSapisidHash(${JSON.stringify(sapisid)}, 'https://www.youtube.com');
        if (!authHash) return { error: 'auth', message: 'Not logged in (SAPISID cookie missing)' };

        const resp = await fetch('/youtubei/v1/like/like?key=' + apiKey + '&prettyPrint=false', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': authHash,
            'X-Origin': 'https://www.youtube.com',
          },
          body: JSON.stringify({ context, target: { videoId: ${JSON.stringify(videoId)} } }),
        });

        if (resp.status === 401 || resp.status === 403) return { error: 'auth', message: 'Not logged in' };
        if (!resp.ok) {
          const body = await resp.json().catch(() => ({}));
          const errStatus = body?.error?.status || '';
          if (errStatus === 'UNAUTHENTICATED') return { error: 'auth', message: 'Not logged in' };
          return { error: 'http', message: 'HTTP ' + resp.status + (errStatus ? ' ' + errStatus : '') };
        }
        return { ok: true };
      })()
    `);
        if (result?.error === 'auth') {
            throw new AuthRequiredError('www.youtube.com');
        }
        if (result?.error) {
            throw new CommandExecutionError(result.message || 'Failed to like video');
        }
        return [{ status: 'success', message: 'Liked: ' + videoId }];
    },
});
