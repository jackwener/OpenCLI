import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { createServer } from 'http';
import { homedir } from 'os';
import { join } from 'path';
import { exec } from 'child_process';
import {
  assertSpotifyCredentialsConfigured,
  getFirstSpotifyTrack,
  mapSpotifyTrackResults,
  parseDotEnv,
  resolveSpotifyCredentials,
} from './utils.js';

// ── Credentials ───────────────────────────────────────────────────────────────
// Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET as environment variables,
// or place them in ~/.opencli/spotify.env:
//   SPOTIFY_CLIENT_ID=your_id
//   SPOTIFY_CLIENT_SECRET=your_secret

const ENV_FILE = join(homedir(), '.opencli', 'spotify.env');

function loadEnv(): Record<string, string> {
  if (!existsSync(ENV_FILE)) return {};
  return parseDotEnv(readFileSync(ENV_FILE, 'utf-8'));
}

const env = loadEnv();
const credentials = resolveSpotifyCredentials(env);
const CLIENT_ID     = credentials.clientId;
const CLIENT_SECRET = credentials.clientSecret;
const REDIRECT_URI  = 'http://127.0.0.1:8888/callback';
const SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'playlist-read-private',
].join(' ');

// ── Token storage ─────────────────────────────────────────────────────────────

const TOKEN_FILE = join(homedir(), '.opencli', 'spotify-tokens.json');

interface Tokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

function loadTokens(): Tokens | null {
  try { return JSON.parse(readFileSync(TOKEN_FILE, 'utf-8')); } catch { return null; }
}

function saveTokens(tokens: Tokens): void {
  mkdirSync(join(homedir(), '.opencli'), { recursive: true });
  writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
}

async function refreshAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64'),
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as any;
    throw new CliError('REFRESH_FAILED', err?.error_description || `Token refresh failed (${res.status})`);
  }
  const data = await res.json() as any;
  const tokens: Tokens = {
    access_token:  data.access_token,
    refresh_token: data.refresh_token || refreshToken,
    expires_at:    Date.now() + data.expires_in * 1000,
  };
  saveTokens(tokens);
  return tokens.access_token;
}

async function getToken(): Promise<string> {
  const tokens = loadTokens();
  if (!tokens) throw new CliError('AUTH_REQUIRED', 'Not authenticated. Run: opencli spotify auth');
  if (!tokens.access_token || !tokens.refresh_token || !(tokens.expires_at > 0)) {
    throw new CliError('AUTH_CORRUPTED', 'Token file is corrupted. Run: opencli spotify auth');
  }
  if (Date.now() > tokens.expires_at - 60_000) return refreshAccessToken(tokens.refresh_token);
  return tokens.access_token;
}

// ── Spotify API helper ────────────────────────────────────────────────────────

async function api(method: string, path: string, body?: unknown): Promise<any> {
  const token = await getToken();
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204 || res.status === 202) return null;
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as any;
    throw new CliError('API_ERROR', err?.error?.message || `Spotify API error ${res.status}`);
  }
  return res.json();
}

async function findTrackUri(query: string): Promise<{ uri: string; name: string; artist: string }> {
  const data = await api('GET', `/search?q=${encodeURIComponent(query)}&type=track&limit=1`);
  const track = getFirstSpotifyTrack(data);
  if (!track) throw new CliError('EMPTY_RESULT', `No track found for: ${query}`);
  return track;
}

function openBrowser(url: string): void {
  const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd);
}

// ── Commands ──────────────────────────────────────────────────────────────────

cli({
  site: 'spotify',
  name: 'auth',
  description: 'Authenticate with Spotify (OAuth — run once)',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [],
  columns: ['status'],
  func: async () => {
    assertSpotifyCredentialsConfigured(credentials, ENV_FILE);
    return new Promise((resolve, reject) => {
      const server = createServer(async (req, res) => {
        try {
          const url = new URL(req.url!, 'http://localhost:8888');
          if (url.pathname !== '/callback') { res.end(); return; }
          const code = url.searchParams.get('code');
          if (!code) { res.end('Missing code'); return; }
          const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              Authorization: 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64'),
            },
            body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI }),
          });
          if (!tokenRes.ok) {
            const err = await tokenRes.json().catch(() => ({})) as any;
            server.close();
            reject(new CliError('AUTH_FAILED', err?.error_description || `Token exchange failed (${tokenRes.status})`));
            return;
          }
          const data = await tokenRes.json() as any;
          saveTokens({ access_token: data.access_token, refresh_token: data.refresh_token, expires_at: Date.now() + data.expires_in * 1000 });
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<h2>Spotify authenticated! You can close this tab.</h2>');
          server.close();
          resolve([{ status: 'Authenticated successfully' }]);
        } catch (e) { server.close(); reject(e); }
      });
      server.on('error', (e: NodeJS.ErrnoException) => {
        if (e.code === 'EADDRINUSE') reject(new CliError('PORT_IN_USE', 'Port 8888 is already in use. Stop the other process and retry.'));
        else reject(e);
      });
      const timeout = setTimeout(() => { server.close(); reject(new CliError('AUTH_TIMEOUT', 'Authentication timed out after 5 minutes')); }, 5 * 60 * 1000);
      server.listen(8888, () => {
        const authUrl = `https://accounts.spotify.com/authorize?${new URLSearchParams({ client_id: CLIENT_ID, response_type: 'code', redirect_uri: REDIRECT_URI, scope: SCOPES })}`;
        console.log('Opening browser for Spotify login...');
        console.log('If it does not open, visit:', authUrl);
        openBrowser(authUrl);
      });
      server.on('close', () => clearTimeout(timeout));
    });
  },
});

cli({
  site: 'spotify',
  name: 'status',
  description: 'Show current playback status',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [],
  columns: ['track', 'artist', 'album', 'status', 'progress'],
  func: async () => {
    const data = await api('GET', '/me/player');
    if (!data || !data.item) return [{ track: 'Nothing playing', artist: '', album: '', status: '', progress: '' }];
    const t = data.item;
    if (t.type !== 'track') return [{ track: t.name, artist: '', album: t.show?.name ?? '', status: data.is_playing ? 'playing' : 'paused', progress: '' }];
    const prog = (data.progress_ms ?? 0) / 1000 | 0;
    const dur  = t.duration_ms / 1000 | 0;
    const fmt  = (s: number) => `${s / 60 | 0}:${String(s % 60).padStart(2, '0')}`;
    return [{ track: t.name, artist: t.artists.map((a: any) => a.name).join(', '), album: t.album.name, status: data.is_playing ? 'playing' : 'paused', progress: `${fmt(prog)} / ${fmt(dur)}` }];
  },
});

cli({
  site: 'spotify',
  name: 'play',
  description: 'Resume playback or search and play a track/artist',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [{ name: 'query', type: 'str', default: '', positional: true, help: 'Track or artist to play (optional)' }],
  columns: ['track', 'artist', 'status'],
  func: async (_page, kwargs) => {
    if (kwargs.query) {
      const { uri, name, artist } = await findTrackUri(kwargs.query);
      await api('PUT', '/me/player/play', { uris: [uri] });
      return [{ track: name, artist, status: 'playing' }];
    }
    await api('PUT', '/me/player/play');
    return [{ track: '', artist: '', status: 'resumed' }];
  },
});

cli({
  site: 'spotify',
  name: 'pause',
  description: 'Pause playback',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [],
  columns: ['status'],
  func: async () => { await api('PUT', '/me/player/pause'); return [{ status: 'paused' }]; },
});

cli({
  site: 'spotify',
  name: 'next',
  description: 'Skip to next track',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [],
  columns: ['status'],
  func: async () => { await api('POST', '/me/player/next'); return [{ status: 'skipped to next' }]; },
});

cli({
  site: 'spotify',
  name: 'prev',
  description: 'Skip to previous track',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [],
  columns: ['status'],
  func: async () => { await api('POST', '/me/player/previous'); return [{ status: 'skipped to previous' }]; },
});

cli({
  site: 'spotify',
  name: 'volume',
  description: 'Set playback volume (0-100)',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [{ name: 'level', type: 'int', default: 50, positional: true, required: true, help: 'Volume 0–100' }],
  columns: ['volume'],
  func: async (_page, kwargs) => {
    const level = Math.round(kwargs.level);
    if (level < 0 || level > 100) throw new CliError('INVALID_ARGS', 'Volume must be between 0 and 100');
    await api('PUT', `/me/player/volume?volume_percent=${level}`);
    return [{ volume: `${level}%` }];
  },
});

cli({
  site: 'spotify',
  name: 'search',
  description: 'Search for tracks',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'query', type: 'str', required: true, positional: true, help: 'Search query' },
    { name: 'limit', type: 'int', default: 10, help: 'Number of results (default: 10)' },
  ],
  columns: ['track', 'artist', 'album', 'uri'],
  func: async (_page, kwargs) => {
    const limit = Math.min(50, Math.max(1, Math.round(kwargs.limit)));
    const data = await api('GET', `/search?q=${encodeURIComponent(kwargs.query)}&type=track&limit=${limit}`);
    const results = mapSpotifyTrackResults(data);
    if (!results.length) throw new CliError('EMPTY_RESULT', `No results found for: ${kwargs.query}`);
    return results;
  },
});

cli({
  site: 'spotify',
  name: 'queue',
  description: 'Add a track to the playback queue',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [{ name: 'query', type: 'str', required: true, positional: true, help: 'Track to add to queue' }],
  columns: ['track', 'artist', 'status'],
  func: async (_page, kwargs) => {
    const { uri, name, artist } = await findTrackUri(kwargs.query);
    await api('POST', `/me/player/queue?uri=${encodeURIComponent(uri)}`);
    return [{ track: name, artist, status: 'added to queue' }];
  },
});

cli({
  site: 'spotify',
  name: 'shuffle',
  description: 'Toggle shuffle on/off',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [{ name: 'state', type: 'str', default: 'on', positional: true, choices: ['on', 'off'], help: 'on or off' }],
  columns: ['shuffle'],
  func: async (_page, kwargs) => {
    await api('PUT', `/me/player/shuffle?state=${kwargs.state === 'on'}`);
    return [{ shuffle: kwargs.state }];
  },
});

cli({
  site: 'spotify',
  name: 'repeat',
  description: 'Set repeat mode (off / track / context)',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [{ name: 'mode', type: 'str', default: 'context', positional: true, choices: ['off', 'track', 'context'], help: 'off / track / context' }],
  columns: ['repeat'],
  func: async (_page, kwargs) => {
    await api('PUT', `/me/player/repeat?state=${kwargs.mode}`);
    return [{ repeat: kwargs.mode }];
  },
});
