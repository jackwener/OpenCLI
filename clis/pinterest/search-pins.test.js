import { beforeAll, describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';

import { createPageMock } from '../test-utils.js';
import './search-pins.js';

let cmd;

/** Wrap raw pin results in the resource_response envelope the endpoint returns. */
function searchResponse(results, bookmark = null) {
  return { resource_response: { data: { results }, bookmark } };
}

function pin(overrides = {}) {
  return {
    type: 'pin',
    id: '111',
    title: 'Cozy Nordic Living Room',
    description: 'Soft neutral tones and light wood.',
    pinner: { username: 'janedoe' },
    board: { name: 'Home' },
    images: { orig: { url: 'https://i.pinimg.com/originals/aa/bb/cc.jpg' } },
    ...overrides,
  };
}

beforeAll(() => {
  cmd = getRegistry().get('pinterest/search-pins');
  expect(cmd?.func).toBeTypeOf('function');
});

describe('pinterest search-pins', () => {

  it('respects the limit and stops paginating once satisfied', async () => {
    const page = createPageMock([searchResponse([pin({ id: '1' }), pin({ id: '2' }), pin({ id: '3' })], 'bm1')]);
    const result = await cmd.func(page, { query: 'x', limit: 2 });
    expect(result).toHaveLength(2);
    // Only one page fetched: the second queued response is never consumed.
    expect(page.evaluate).toHaveBeenCalledTimes(1);
  });

  it('paginates across pages via the bookmark, de-duplicating pins', async () => {
    const page = createPageMock([
      searchResponse([pin({ id: '1' }), pin({ id: '2' })], 'bm1'),
      searchResponse([pin({ id: '2' }), pin({ id: '3' })], null),
    ]);
    const result = await cmd.func(page, { query: 'x', limit: 5 });
    expect(result.map((r) => r.pinId)).toEqual(['1', '2', '3']);
    expect(page.evaluate).toHaveBeenCalledTimes(2);
  });

  it('asks only for the rows still missing and rejects an unknown scope', async () => {
    const page = createPageMock([searchResponse([pin({ id: '9' })], null)]);
    const rows = await cmd.func(page, { query: 'x', limit: 7, scope: 'my_pins' });
    expect('nextBookmark' in rows[0]).toBe(false);
    const sent = JSON.parse(decodeURIComponent(page.evaluate.mock.calls[0][0].match(/data=([^"&]+)/)[1]));
    expect(sent.options).toMatchObject({ page_size: 7, scope: 'my_pins' });

    await expect(cmd.func(createPageMock([]), { query: 'x', scope: 'mine' })).rejects.toThrow(ArgumentError);
  });

  it('keeps paging fixed 25-row pages until a large --limit is met', async () => {
    const pages = Array.from({ length: 12 }, (_, p) => searchResponse(
      Array.from({ length: 25 }, (__, i) => pin({ id: String(p * 25 + i + 1) })),
      `bm${p + 1}`,
    ));
    const result = await cmd.func(createPageMock(pages), { query: 'x', limit: 300, scope: 'videos' });
    expect(result).toHaveLength(300);
  });

  it('maps link, domain, creation time, media type and alt text onto the row', async () => {
    const page = createPageMock([searchResponse([pin({
      link: 'https://example.com/a',
      domain: 'example.com',
      created_at: 'Mon, 09 Nov 2026 01:51:15 +0000',
      alt_text: ' a sofa ', videos: { video_list: { V_HLSV4: { url: 'https://v/x.m3u8' } } },
    })])]);
    const [row] = await cmd.func(page, { query: 'x', limit: 1 });
    expect(row).toMatchObject({
      link: 'https://example.com/a',
      domain: 'example.com',
      createdAt: '2026-11-09T01:51:15.000Z',
      mediaType: 'video',
      altText: 'a sofa',
    });
  });

});
