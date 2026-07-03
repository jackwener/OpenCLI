import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTorrentQuery } from './torrents.js';

test('buildTorrentQuery maps friendly filters to U2 parameters', () => {
  const params = buildTorrentQuery({
    query: 'Steins Gate', category: '16', status: 'dead', promotion: 'free',
    bookmarked: 'only', area: 'anidb', mode: 'exact', limit: 12, page: 2,
  });
  assert.equal(params.limit, 12);
  assert.deepEqual(Object.fromEntries(params.searchParams), {
    search: 'Steins Gate', cat16: '1', incldead: '2', spstate: '2',
    inclbookmarked: '1', search_area: '4', search_mode: '2', page: '1',
  });
});

test('buildTorrentQuery supports defaults and all categories', () => {
  const params = buildTorrentQuery({});
  assert.equal(params.limit, 50);
  assert.deepEqual(Object.fromEntries(params.searchParams), {
    incldead: '1', spstate: '0', inclbookmarked: '0', search_area: '0', search_mode: '0',
  });
});

for (const [label, args] of [
  ['status', { status: 'maybe' }],
  ['promotion', { promotion: 'bonus' }],
  ['bookmarked', { bookmarked: 'sometimes' }],
  ['area', { area: 'body' }],
  ['mode', { mode: 'fuzzy' }],
  ['category', { category: 'x16' }],
  ['page', { page: 0 }],
  ['limit', { limit: 0 }],
  ['limit', { limit: 51 }],
]) {
  test(`buildTorrentQuery rejects invalid ${label}`, () => {
    assert.throws(() => buildTorrentQuery(args), /must be|invalid/i);
  });
}
