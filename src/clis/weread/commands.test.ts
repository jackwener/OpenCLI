import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFetchPrivateApi } = vi.hoisted(() => ({
  mockFetchPrivateApi: vi.fn(),
}));

vi.mock('./utils.js', async () => {
  const actual = await vi.importActual<typeof import('./utils.js')>('./utils.js');
  return {
    ...actual,
    fetchPrivateApi: mockFetchPrivateApi,
  };
});

import { getRegistry } from '../../registry.js';
import './book.js';
import './highlights.js';
import './notes.js';

describe('weread book-id positional args', () => {
  const book = getRegistry().get('weread/book');
  const highlights = getRegistry().get('weread/highlights');
  const notes = getRegistry().get('weread/notes');

  beforeEach(() => {
    mockFetchPrivateApi.mockReset();
  });

  it('passes the positional book-id to book details', async () => {
    mockFetchPrivateApi.mockResolvedValue({ title: 'Three Body', newRating: 880 });

    await book!.func!({} as any, { 'book-id': '12345' });

    expect(mockFetchPrivateApi).toHaveBeenCalledWith({}, '/book/info', { bookId: '12345' });
  });

  it('passes the positional book-id to highlights', async () => {
    mockFetchPrivateApi.mockResolvedValue({ updated: [] });

    await highlights!.func!({} as any, { 'book-id': 'abc', limit: 5 });

    expect(mockFetchPrivateApi).toHaveBeenCalledWith({}, '/book/bookmarklist', { bookId: 'abc' });
  });

  it('passes the positional book-id to notes', async () => {
    mockFetchPrivateApi.mockResolvedValue({ reviews: [] });

    await notes!.func!({} as any, { 'book-id': 'xyz', limit: 5 });

    expect(mockFetchPrivateApi).toHaveBeenCalledWith({}, '/review/list', {
      bookId: 'xyz',
      listType: '11',
      mine: '1',
      synckey: '0',
    });
  });
});
