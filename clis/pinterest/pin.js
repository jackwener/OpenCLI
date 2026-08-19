// Pinterest pin — details of a single pin (PinResource, one row).
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { PINTEREST_BASE, parsePinId, pickPinImage, pinterestResourceFetch } from './utils.js';

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
  columns: ['pinId', 'title', 'description', 'pinner', 'board', 'saveCount', 'commentCount', 'link', 'imageUrl', 'url'],
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

    return [
      {
        pinId: String(pin.id),
        title: (pin.title || pin.grid_title || '').trim(),
        description: (typeof pin.description === 'string' ? pin.description : '').trim(),
        pinner: (pin.pinner && pin.pinner.username) || '',
        board: (pin.board && pin.board.name) || '',
        saveCount: typeof pin.repin_count === 'number' ? pin.repin_count : 0,
        commentCount: typeof pin.comment_count === 'number' ? pin.comment_count : 0,
        link: pin.link || '',
        imageUrl: pickPinImage(pin.images),
        url: `${PINTEREST_BASE}/pin/${pin.id}/`,
      },
    ];
  },
});
