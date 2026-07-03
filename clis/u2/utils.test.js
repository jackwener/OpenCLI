import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assertAuthenticated, decodeEntities, getCookie, parseTorrentRows, parseSubtitleRows } from './utils.js';

const fixture = name => readFile(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8');

test('parseTorrentRows extracts stable torrent fields', async () => {
  const rows = parseTorrentRows(await fixture('torrents.html'));
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    id: '65431', category: 'BDMV', title: 'Example & One', comments: 1,
    publishedAt: '2026-07-03T09:45:57+08:00', size: '32.600 GiB',
    seeders: 28, leechers: 0, snatched: 65, promotion: '2X',
    detailsUrl: 'https://u2.dmhy.org/details.php?id=65431',
  });
  assert.equal(rows[1].promotion, '2X Free');
});

test('parseSubtitleRows extracts stable subtitle fields', async () => {
  const rows = parseSubtitleRows(await fixture('subtitles.html'));
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    id: '10270', language: 'S.Chinese(简体中文)', title: '[KissSub][Steins;Gate]',
    publishedAt: '2026-07-02T15:54:33+08:00', size: '648.533 KiB',
    downloads: 0, uploader: 'UploaderA',
  });
  assert.equal(rows[1].uploader, '匿名');
  assert.equal(rows[1].title, 'Example & Two');
});

test('parsers return no rows for unrelated HTML', () => {
  assert.deepEqual(parseTorrentRows('<html><body>none</body></html>'), []);
  assert.deepEqual(parseSubtitleRows('<html><body>none</body></html>'), []);
});

test('decodeEntities accepts semicolonless ampersands emitted by U2', () => {
  assert.equal(decodeEntities('SC-OL&amp 1-24'), 'SC-OL& 1-24');
});

test('assertAuthenticated rejects the U2 login page', () => {
  assert.throws(
    () => assertAuthenticated('<form action="takelogin.php"><input name="username"></form>'),
    error => error?.code === 'AUTH_REQUIRED' && error?.exitCode === 77,
  );
});

test('getCookie rejects a browser session without U2 cookies', async () => {
  await assert.rejects(
    () => getCookie({ getCookies: async () => [] }),
    error => error?.code === 'AUTH_REQUIRED' && error?.exitCode === 77,
  );
});
