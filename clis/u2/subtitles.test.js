import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSubtitleQuery } from './subtitles.js';

test('buildSubtitleQuery maps keyword and language ID', () => {
  const params = buildSubtitleQuery({ query: 'Steins Gate', language: '25', limit: 12, page: 3 });
  assert.equal(params.limit, 12);
  assert.deepEqual(Object.fromEntries(params.searchParams), { search: 'Steins Gate', lang_id: '25', page: '2' });
});

test('buildSubtitleQuery defaults to all languages', () => {
  const params = buildSubtitleQuery({});
  assert.equal(params.limit, 30);
  assert.deepEqual(Object.fromEntries(params.searchParams), { lang_id: '0' });
});

for (const [label, args] of [
  ['language', { language: 'zh' }],
  ['language', { language: '0' }],
  ['language', { language: '33' }],
  ['page', { page: 0 }],
  ['limit', { limit: -1 }],
  ['limit', { limit: 31 }],
]) {
  test(`buildSubtitleQuery rejects invalid ${label}`, () => {
    assert.throws(() => buildSubtitleQuery(args), /must be|invalid/i);
  });
}
