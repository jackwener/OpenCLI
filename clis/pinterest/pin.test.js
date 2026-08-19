import { beforeAll, describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, EmptyResultError } from '@jackwener/opencli/errors';
import { createPageMock } from '../test-utils.js';
import './pin.js';

let cmd;

/** PinResource response: the raw pin object under resource_response.data. */
function pinDetail(overrides = {}) {
  return {
    resource_response: {
      data: {
        id: '1234567890123456',
        title: 'Scandinavian Living Room',
        description: 'Soft neutral tones.',
        pinner: { username: 'janedoe' },
        board: { name: 'House' },
        repin_count: 614,
        comment_count: 3,
        link: 'https://example.com/article',
        images: { orig: { url: 'https://i.pinimg.com/originals/a/b/c.png' } },
        ...overrides,
      },
    },
  };
}

beforeAll(() => {
  cmd = getRegistry().get('pinterest/pin');
  expect(cmd?.func).toBeTypeOf('function');
});

describe('pinterest pin', () => {
  it('throws ArgumentError on a non-pin reference', async () => {
    await expect(cmd.func(createPageMock([]), { pin: 'not-a-pin' })).rejects.toThrow(ArgumentError);
  });

  it('accepts a bare id and a pin URL', async () => {
    for (const pin of ['1234567890123456', 'https://www.pinterest.com/pin/1234567890123456/']) {
      const page = createPageMock([pinDetail()]);
      const result = await cmd.func(page, { pin });
      expect(result).toHaveLength(1);
    }
  });

  it('throws AuthRequiredError on 401', async () => {
    await expect(cmd.func(createPageMock([{ __httpError: 401 }]), { pin: '1234567890123456' })).rejects.toThrow(AuthRequiredError);
  });

  it('maps the full detail row', async () => {
    const result = await cmd.func(createPageMock([pinDetail()]), { pin: '1234567890123456' });
    expect(result[0]).toEqual({
      pinId: '1234567890123456',
      title: 'Scandinavian Living Room',
      description: 'Soft neutral tones.',
      pinner: 'janedoe',
      board: 'House',
      saveCount: 614,
      commentCount: 3,
      link: 'https://example.com/article',
      imageUrl: 'https://i.pinimg.com/originals/a/b/c.png',
      url: 'https://www.pinterest.com/pin/1234567890123456/',
    });
  });

  it('defaults missing counts and link', async () => {
    const result = await cmd.func(createPageMock([pinDetail({ repin_count: undefined, comment_count: undefined, link: null })]), { pin: '1234567890123456' });
    expect(result[0]).toMatchObject({ saveCount: 0, commentCount: 0, link: '' });
  });

  it('throws EmptyResultError when the pin is missing', async () => {
    const page = createPageMock([{ resource_response: { data: {} } }]);
    await expect(cmd.func(page, { pin: '999' })).rejects.toThrow(EmptyResultError);
  });
});
