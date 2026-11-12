import { beforeAll, describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { createPageMock } from '../test-utils.js';
import './board-pins.js';

let cmd;

const boardMeta = { resource_response: { data: { id: '999', name: 'Home' } } };
const sections = { resource_response: { data: [{ id: 'sec-1', title: 'Cats', slug: 'cats' }] } };
const feed = { resource_response: { data: [{ type: 'pin', id: '1' }], bookmark: null } };

const sentOptions = (page, call) => JSON.parse(decodeURIComponent(page.evaluate.mock.calls[call][0].match(/data=([^"&]+)/)[1])).options;

beforeAll(() => {
  cmd = getRegistry().get('pinterest/board-pins');
  expect(cmd?.func).toBeTypeOf('function');
});

describe('pinterest board-pins', () => {
  it('hides section pins by default and includes them with --include-sections', async () => {
    const root = createPageMock([boardMeta, feed]);
    await cmd.func(root, { board: 'me/home' });
    expect(root.evaluate.mock.calls[1][0]).toContain('/resource/BoardFeedResource/get/');
    expect(sentOptions(root, 1).filter_section_pins).toBe(true);

    const all = createPageMock([boardMeta, feed]);
    await cmd.func(all, { board: 'me/home', 'include-sections': true });
    expect(sentOptions(all, 1)).toMatchObject({ filter_section_pins: false });
  });

  it('lists a single section through BoardSectionPinsResource', async () => {
    const page = createPageMock([boardMeta, sections, feed]);
    const rows = await cmd.func(page, { board: 'me/home', section: 'cats', bookmark: 'bm1' });
    expect(rows.map((r) => r.pinId)).toEqual(['1']);
    expect(page.evaluate.mock.calls[2][0]).toContain('/resource/BoardSectionPinsResource/get/');
    // The section feed rejects page_size above 50, so a larger --limit is split across pages.
    expect(sentOptions(page, 2)).toMatchObject({ section_id: 'sec-1', bookmarks: ['bm1'], page_size: 25 });

    const big = createPageMock([boardMeta, sections, feed]);
    await cmd.func(big, { board: 'me/home', section: 'cats', limit: 200 });
    expect(sentOptions(big, 2).page_size).toBe(50);
  });

  it('rejects --section together with --include-sections before any request', async () => {
    const page = createPageMock([]);
    await expect(cmd.func(page, { board: 'me/home', section: 'cats', 'include-sections': true })).rejects.toThrow(/cannot be combined/);
    expect(page.evaluate).not.toHaveBeenCalled();
  });
});
