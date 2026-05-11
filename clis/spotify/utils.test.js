import { describe, expect, it } from 'vitest';
import { assertSpotifyCredentialsConfigured, getFirstSpotifyTrack, hasConfiguredSpotifyCredentials, mapSpotifyTrackResults, parseDotEnv, resolveSpotifyCredentials, } from './utils.js';
describe('spotify utils', () => {
    it('parses dotenv-style credential files', () => {
        const env = parseDotEnv(`
      # Spotify credentials
      SPOTIFY_CLIENT_ID=abc123
      SPOTIFY_CLIENT_SECRET=def456
    `);
        expect(env).toEqual({
            SPOTIFY_CLIENT_ID: 'abc123',
            SPOTIFY_CLIENT_SECRET: 'def456',
        });
    });
    it('prefers explicit process env over file values', () => {
        const credentials = resolveSpotifyCredentials({
            SPOTIFY_CLIENT_ID: 'file-id',
            SPOTIFY_CLIENT_SECRET: 'file-secret',
        }, {
            SPOTIFY_CLIENT_ID: 'env-id',
            SPOTIFY_CLIENT_SECRET: 'env-secret',
        });
        expect(credentials).toEqual({
            clientId: 'env-id',
            clientSecret: 'env-secret',
        });
    });
    it('treats placeholder values as unconfigured credentials', () => {
        expect(hasConfiguredSpotifyCredentials({
            clientId: 'your_spotify_client_id_here',
            clientSecret: 'your_spotify_client_secret_here',
        })).toBe(false);
    });
    it('throws a helpful CONFIG error for empty or placeholder credentials', () => {
        expect(() => assertSpotifyCredentialsConfigured({
            clientId: '',
            clientSecret: '',
        }, '/tmp/spotify.env')).toThrow(/Missing Spotify credentials/);
        expect(() => assertSpotifyCredentialsConfigured({
            clientId: 'your_spotify_client_id_here',
            clientSecret: 'real-secret',
        }, '/tmp/spotify.env')).toThrow(/Fill in SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET/);
    });
    it('maps search payloads into stable track summaries', () => {
        const results = mapSpotifyTrackResults({
            tracks: {
                items: [
                    {
                        name: 'Numb',
                        artists: [{ name: 'Linkin Park' }, { name: 'Jay-Z' }],
                        album: { name: 'Encore' },
                        uri: 'spotify:track:123',
                    },
                ],
            },
        });
        expect(results).toEqual([
            {
                track: 'Numb',
                artist: 'Linkin Park, Jay-Z',
                album: 'Encore',
                uri: 'spotify:track:123',
            },
        ]);
        expect(getFirstSpotifyTrack({ tracks: { items: [] } })).toBeNull();
    });
});
