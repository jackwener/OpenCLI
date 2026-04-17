import { CliError } from '@jackwener/opencli/errors';
const SPOTIFY_PLACEHOLDER_PATTERNS = [
    /^your_spotify_client_id_here$/i,
    /^your_spotify_client_secret_here$/i,
    /^your_.+_here$/i,
];
export function parseDotEnv(content) {
    return Object.fromEntries(content
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#') && line.includes('='))
        .map(line => {
        const index = line.indexOf('=');
        return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
    }));
}
export function resolveSpotifyCredentials(fileEnv, processEnv = process.env) {
    return {
        clientId: processEnv.SPOTIFY_CLIENT_ID || fileEnv.SPOTIFY_CLIENT_ID || '',
        clientSecret: processEnv.SPOTIFY_CLIENT_SECRET || fileEnv.SPOTIFY_CLIENT_SECRET || '',
    };
}
export function isPlaceholderCredential(value) {
    const normalized = value?.trim() || '';
    if (!normalized)
        return false;
    return SPOTIFY_PLACEHOLDER_PATTERNS.some(pattern => pattern.test(normalized));
}
export function hasConfiguredSpotifyCredentials(credentials) {
    return Boolean(credentials.clientId.trim()) &&
        Boolean(credentials.clientSecret.trim()) &&
        !isPlaceholderCredential(credentials.clientId) &&
        !isPlaceholderCredential(credentials.clientSecret);
}
export function assertSpotifyCredentialsConfigured(credentials, envFile) {
    if (hasConfiguredSpotifyCredentials(credentials))
        return;
    throw new CliError('CONFIG', `Missing Spotify credentials.\n\n` +
        `1. Go to https://developer.spotify.com/dashboard and create an app\n` +
        `2. Add ${'http://127.0.0.1:8888/callback'} as a Redirect URI\n` +
        `3. Copy your Client ID and Client Secret\n` +
        `4. Open the file: ${envFile}\n` +
        `5. Fill in SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET, then save\n` +
        `6. Run: opencli spotify auth`);
}
export function mapSpotifyTrackResults(data) {
    const items = data?.tracks?.items;
    if (!Array.isArray(items))
        return [];
    return items.map((track) => ({
        track: track?.name || '',
        artist: Array.isArray(track?.artists) ? track.artists.map((artist) => artist.name).join(', ') : '',
        album: track?.album?.name || '',
        uri: track?.uri || '',
    }));
}
export function getFirstSpotifyTrack(data) {
    const track = mapSpotifyTrackResults(data)[0];
    if (!track)
        return null;
    return {
        uri: track.uri,
        name: track.track,
        artist: track.artist,
    };
}
