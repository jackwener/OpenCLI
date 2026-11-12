// Pinterest pin — details of a single pin (PinResource, one row).
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { PINTEREST_BASE, collectPinMedia, parsePinId, pickPinImage, pinMediaType, pinterestResourceFetch, toIsoDate } from './utils.js';

cli({
  site: 'pinterest',
  name: 'pin',
  access: 'read',
  description: 'Get details of a Pinterest pin',
  domain: 'www.pinterest.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'pin', type: 'string', positional: true, required: true, help: 'Pin id or pin URL, e.g. 1234567890123456' },
  ],
  columns: [
    'pinId', 'title', 'description', 'pinner', 'board', 'boardId', 'boardUrl', 'section', 'sectionId',
    'saveCount', 'commentCount', 'link', 'domain', 'createdAt', 'mediaType', 'altText', 'isRepin',
    'imageUrl', 'videoUrl', 'url',
  ],
  func: async (page, kwargs) => {
    const id = parsePinId(kwargs.pin);
    const sourceUrl = `/pin/${id}/`;

    await page.goto(`${PINTEREST_BASE}${sourceUrl}`);

    const { data: pin } = await pinterestResourceFetch(
      page,
      'PinResource',
      { id, field_set_key: 'detailed' },
      sourceUrl,
    );
    if (!pin || !pin.id) {
      throw new EmptyResultError('pinterest pin', `pin "${id}" not found`);
    }

    const board = pin.board || {};
    const section = pin.section || {};
    // First video among the pin's media: an mp4 when Pinterest serves one, else the HLS playlist.
    const video = collectPinMedia(pin).find((item) => item.kind === 'video');

    return [
      {
        pinId: String(pin.id),
        title: (pin.title || pin.grid_title || '').trim(),
        description: (typeof pin.description === 'string' ? pin.description : '').trim(),
        pinner: (pin.pinner && pin.pinner.username) || '',
        board: board.name || '',
        // boardId / boardUrl are both accepted wherever a command takes --board.
        boardId: board.id ? String(board.id) : '',
        boardUrl: board.url ? `${PINTEREST_BASE}${board.url}` : '',
        section: (section.title || '').trim(),
        sectionId: section.id ? String(section.id) : '',
        saveCount: typeof pin.repin_count === 'number' ? pin.repin_count : 0,
        commentCount: typeof pin.comment_count === 'number' ? pin.comment_count : 0,
        link: pin.link || '',
        domain: pin.domain || '',
        createdAt: toIsoDate(pin.created_at),
        mediaType: pinMediaType(pin),
        altText: (typeof pin.alt_text === 'string' ? pin.alt_text : '').trim(),
        isRepin: pin.is_repin === true,
        imageUrl: pickPinImage(pin.images),
        videoUrl: (video && video.url) || '',
        url: `${PINTEREST_BASE}/pin/${pin.id}/`,
      },
    ];
  },
});
