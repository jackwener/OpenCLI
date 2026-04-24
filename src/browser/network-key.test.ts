import { describe, expect, it } from 'vitest';
import { assignKeys, deriveKey } from './network-key.js';

describe('deriveKey', () => {
    it('extracts operationName from Twitter-style graphql URLs', () => {
        expect(deriveKey({
            method: 'GET',
            url: 'https://x.com/i/api/graphql/6fWQaBPK51aGyC_VC7t9GQ/UserTweets?variables=...',
        })).toBe('UserTweets');
    });

    it('handles graphql URLs without a query id', () => {
        expect(deriveKey({
            method: 'POST',
            url: 'https://example.com/graphql/MyOp?vars=1',
        })).toBe('MyOp');
    });

    it('uses METHOD host+pathname for REST calls', () => {
        expect(deriveKey({
            method: 'get',
            url: 'https://api.example.com/v1/users?page=1',
        })).toBe('GET api.example.com/v1/users');
    });

    it('falls back to truncated raw url when URL parsing fails', () => {
        const key = deriveKey({ method: 'GET', url: 'not-a-valid-url' });
        expect(key.startsWith('GET ')).toBe(true);
        expect(key).toContain('not-a-valid-url');
    });
});

describe('assignKeys', () => {
    it('disambiguates collisions with #N suffixes', () => {
        const out = assignKeys([
            { url: 'https://x.com/i/api/graphql/a/UserTweets', method: 'GET' },
            { url: 'https://x.com/i/api/graphql/b/UserTweets', method: 'GET' },
            { url: 'https://api.example.com/v1/u', method: 'GET' },
            { url: 'https://api.example.com/v1/u', method: 'GET' },
            { url: 'https://api.example.com/v1/u', method: 'GET' },
        ]);
        expect(out.map(o => o.key)).toEqual([
            'UserTweets',
            'UserTweets#2',
            'GET api.example.com/v1/u',
            'GET api.example.com/v1/u#2',
            'GET api.example.com/v1/u#3',
        ]);
    });

    it('preserves extra fields on each request', () => {
        const out = assignKeys([{ url: 'https://a.com/x', method: 'GET', status: 200 }]);
        expect(out[0]).toMatchObject({ status: 200, key: 'GET a.com/x' });
    });
});
