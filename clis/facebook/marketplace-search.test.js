import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { __test__ } from './marketplace-search.js';

const {
  buildSearchUrl,
  normalizeRows,
  optionalDays,
  optionalLocation,
  parseListingLabel,
  parseListingSpans,
  parsePrice,
  requireLimit,
  requireSort,
} = __test__;

function makePage(overrides = {}) {
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue({ status: 'no_rows', href: '', rows: [], diagnostics: {} }),
    ...overrides,
  };
}

function okPayload(rows, href = 'https://www.facebook.com/marketplace/category/search/?query=bike') {
  return { status: 'ok', href, rows, diagnostics: { anchorCount: rows.length } };
}

const CARD_BIKE = {
  id: '1727594701690671',
  label: 'Bike. 20” mongoose, $50, Holt, MI, listing 1727594701690671',
  spans: ['$50', '$50', 'Bike. 20” mongoose', 'Bike. 20” mongoose', 'Holt, MI', 'Holt, MI'],
  image: 'https://scontent.xx.fbcdn.net/v/t39.84726-6/bike.jpg',
};
const CARD_JUST_LISTED = {
  id: '1441153484591442',
  label: 'Guardian Balance Bike, $100, Dewitt, MI, listing 1441153484591442',
  spans: ['Just listed', 'Just listed', '$100', '$100', 'Guardian Balance Bike', 'Dewitt, MI'],
  image: '',
};
const CARD_REDUCED = {
  id: '1567958064993284',
  label: 'Schwinn steel bike vintage, $60, reduced from $100, Chicago, IL, listing 1567958064993284',
  spans: ['$60', '$100', 'Schwinn steel bike vintage', 'Chicago, IL'],
  image: '',
};
const CARD_SHIPPED = {
  id: '1060564333042157',
  label: 'North Face Borealis Black Backpack, $40, , listing 1060564333042157',
  spans: ['$40', 'North Face Borealis Black Backpack'],
  image: '',
};

describe('facebook marketplace-search helpers', () => {
  it('parses plain, currency-prefixed, thousands-separated and free prices', () => {
    expect(parsePrice('$50')).toEqual({ price: 50, currency: '$' });
    expect(parsePrice('CA$80')).toEqual({ price: 80, currency: 'CA$' });
    expect(parsePrice('$1,234,567')).toEqual({ price: 1234567, currency: '$' });
    expect(parsePrice('£9.99')).toEqual({ price: 9.99, currency: '£' });
    expect(parsePrice('Free')).toEqual({ price: 0, currency: null });
    expect(parsePrice('Holt, MI')).toBeNull();
    expect(parsePrice('')).toBeNull();
  });

  it('parses the standard aria-label shape', () => {
    expect(parseListingLabel(CARD_BIKE.label)).toEqual({
      id: '1727594701690671',
      title: 'Bike. 20” mongoose',
      price: 50,
      currency: '$',
      originalPrice: null,
      location: 'Holt, MI',
    });
  });

  it('keeps commas inside the title and reads reduced-from prices', () => {
    expect(parseListingLabel('Trek, 21 speed, mint, $250, reduced from $300, Troy, MI, listing 42')).toEqual({
      id: '42',
      title: 'Trek, 21 speed, mint',
      price: 250,
      currency: '$',
      originalPrice: 300,
      location: 'Troy, MI',
    });
  });

  it('returns null location for shipped-only items with an empty location segment', () => {
    expect(parseListingLabel(CARD_SHIPPED.label)).toMatchObject({
      id: '1060564333042157',
      title: 'North Face Borealis Black Backpack',
      price: 40,
      location: null,
    });
  });

  it('rejects labels without a listing id or price', () => {
    expect(parseListingLabel('Just some text')).toBeNull();
    expect(parseListingLabel('No price here, Holt, MI, listing 1')).toBeNull();
    expect(parseListingLabel('$50, listing 1')).toBeNull(); // price with no title
  });

  it('falls back to span order when the label is unusable', () => {
    expect(parseListingSpans(CARD_JUST_LISTED.spans)).toEqual({
      title: 'Guardian Balance Bike',
      price: 100,
      currency: '$',
      originalPrice: null,
      location: 'Dewitt, MI',
    });
    expect(parseListingSpans(['no', 'price'])).toBeNull();
  });

  it('normalizes rows with badge, image, absolute url and 1-based index', () => {
    const rows = normalizeRows([CARD_BIKE, CARD_JUST_LISTED, CARD_REDUCED, CARD_SHIPPED], 10);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toEqual({
      index: 1,
      id: '1727594701690671',
      title: 'Bike. 20” mongoose',
      price: 50,
      currency: '$',
      originalPrice: null,
      location: 'Holt, MI',
      badge: null,
      image: 'https://scontent.xx.fbcdn.net/v/t39.84726-6/bike.jpg',
      url: 'https://www.facebook.com/marketplace/item/1727594701690671/',
    });
    expect(rows[1].badge).toBe('Just listed');
    expect(rows[1].image).toBeNull();
    expect(rows[2].originalPrice).toBe(100);
    expect(rows[3].location).toBeNull();
  });

  it('uses the span fallback when a card has no aria-label', () => {
    const rows = normalizeRows([{ ...CARD_BIKE, label: '' }], 10);
    expect(rows[0]).toMatchObject({ title: 'Bike. 20” mongoose', price: 50, location: 'Holt, MI' });
  });

  it('honours limit in normalizeRows', () => {
    expect(normalizeRows([CARD_BIKE, CARD_JUST_LISTED], 1)).toHaveLength(1);
  });

  it('builds the search url with every supported filter', () => {
    expect(buildSearchUrl({ query: 'road bike' })).toBe(
      'https://www.facebook.com/marketplace/category/search/?query=road+bike',
    );
    expect(buildSearchUrl({
      query: 'bike', location: 'chicago', minPrice: 100, maxPrice: 300, sort: 'newest', days: 7, exact: true,
    })).toBe(
      'https://www.facebook.com/marketplace/chicago/search?query=bike&minPrice=100&maxPrice=300&sortBy=creation_time_descend&daysSinceListed=7&exact=true',
    );
    expect(buildSearchUrl({ query: 'bike', sort: 'price-asc' })).toContain('sortBy=price_ascend');
    expect(buildSearchUrl({ query: 'bike', sort: 'price-desc' })).toContain('sortBy=price_descend');
    expect(buildSearchUrl({ query: 'bike', sort: 'distance' })).toContain('sortBy=distance_ascend');
    expect(buildSearchUrl({ query: 'bike', sort: 'best' })).not.toContain('sortBy');
  });

  it('validates limit, sort, days and location upfront', () => {
    expect(requireLimit(undefined)).toBe(20);
    expect(() => requireLimit(0)).toThrow(ArgumentError);
    expect(() => requireLimit(101)).toThrow(ArgumentError);
    expect(() => requireLimit('abc')).toThrow(ArgumentError);
    expect(requireSort(undefined)).toBe('best');
    expect(requireSort('Newest')).toBe('newest');
    expect(() => requireSort('cheapest')).toThrow(ArgumentError);
    expect(optionalDays(undefined)).toBeNull();
    expect(optionalDays(7)).toBe(7);
    expect(() => optionalDays(3)).toThrow(ArgumentError);
    expect(optionalLocation(' Chicago ')).toBe('chicago');
    expect(optionalLocation('')).toBeNull();
    expect(() => optionalLocation('east lansing')).toThrow(ArgumentError);
  });
});

describe('facebook marketplace-search command', () => {
  it('is registered with the expected args and columns', () => {
    const command = getRegistry().get('facebook/marketplace-search');
    expect(command).toBeDefined();
    expect(command.access).toBe('read');
    expect(command.args.map((a) => a.name)).toEqual([
      'query', 'location', 'limit', 'min-price', 'max-price', 'sort', 'days', 'exact',
    ]);
    expect(command.columns).toEqual([
      'index', 'id', 'title', 'price', 'currency', 'originalPrice', 'location', 'badge', 'image', 'url',
    ]);
  });

  it('navigates to the filtered search url and returns normalized rows', async () => {
    const command = getRegistry().get('facebook/marketplace-search');
    const page = makePage({
      evaluate: vi.fn().mockResolvedValue(okPayload([CARD_BIKE, CARD_JUST_LISTED], 'https://www.facebook.com/marketplace/chicago/search?query=bike')),
    });

    const rows = await command.func(page, { query: 'bike', location: 'chicago', limit: 5, 'min-price': 10, 'max-price': 500, sort: 'newest' });

    expect(page.goto).toHaveBeenCalledWith(
      'https://www.facebook.com/marketplace/chicago/search?query=bike&minPrice=10&maxPrice=500&sortBy=creation_time_descend',
      { settleMs: 4000 },
    );
    // limit <= page size: extract only, no scroll round
    expect(page.evaluate).toHaveBeenCalledTimes(1);
    expect(rows.map((r) => r.title)).toEqual(['Bike. 20” mongoose', 'Guardian Balance Bike']);
    expect(rows[1].badge).toBe('Just listed');
  });

  it('scrolls for more cards when limit exceeds one batch and stops once enough are loaded', async () => {
    const command = getRegistry().get('facebook/marketplace-search');
    const evaluate = vi.fn()
      .mockResolvedValueOnce(24) // scroll round 1
      .mockResolvedValueOnce(42) // scroll round 2 -> >= limit, stop
      .mockResolvedValueOnce(okPayload(Array.from({ length: 40 }, (_, i) => ({ ...CARD_BIKE, id: String(i + 1), label: `Item ${i + 1}, $${i + 1}, Holt, MI, listing ${i + 1}` }))));
    const page = makePage({ evaluate });

    const rows = await command.func(page, { query: 'bike', limit: 40 });

    expect(evaluate).toHaveBeenCalledTimes(3);
    expect(rows).toHaveLength(40);
    expect(rows[39].id).toBe('40');
  });

  it('stops scrolling after two stalled rounds', async () => {
    const command = getRegistry().get('facebook/marketplace-search');
    const evaluate = vi.fn()
      .mockResolvedValueOnce(24)
      .mockResolvedValueOnce(24) // stalled 1
      .mockResolvedValueOnce(24) // stalled 2 -> stop
      .mockResolvedValueOnce(okPayload([CARD_BIKE]));
    const page = makePage({ evaluate });

    const rows = await command.func(page, { query: 'bike', limit: 60 });

    expect(evaluate).toHaveBeenCalledTimes(4);
    expect(rows).toHaveLength(1);
  });

  it('retries once when the bridge rejects the first navigation', async () => {
    const command = getRegistry().get('facebook/marketplace-search');
    const goto = vi.fn()
      .mockRejectedValueOnce(new Error('Navigation rejected.'))
      .mockResolvedValueOnce(undefined);
    const page = makePage({ goto, evaluate: vi.fn().mockResolvedValue(okPayload([CARD_BIKE])) });

    const rows = await command.func(page, { query: 'bike' });

    expect(goto).toHaveBeenCalledTimes(2);
    expect(rows).toHaveLength(1);
  });

  it('falls back to a new tab when navigation is rejected twice', async () => {
    const command = getRegistry().get('facebook/marketplace-search');
    const goto = vi.fn().mockRejectedValue(new Error('Navigation rejected.'));
    const newTab = vi.fn().mockResolvedValue('tab-2');
    const setActivePage = vi.fn();
    const page = makePage({ goto, newTab, setActivePage, evaluate: vi.fn().mockResolvedValue(okPayload([CARD_BIKE])) });

    const rows = await command.func(page, { query: 'bike' });

    expect(goto).toHaveBeenCalledTimes(2);
    expect(newTab).toHaveBeenCalledWith(expect.stringContaining('/marketplace/category/search/?query=bike'));
    expect(setActivePage).toHaveBeenCalledWith('tab-2');
    expect(rows).toHaveLength(1);
  });

  it('does not retry non-navigation errors', async () => {
    const command = getRegistry().get('facebook/marketplace-search');
    const goto = vi.fn().mockRejectedValue(new Error('Extension not connected'));
    const page = makePage({ goto });

    await expect(command.func(page, { query: 'bike' })).rejects.toThrow(CommandExecutionError);
    expect(goto).toHaveBeenCalledTimes(1);
  });

  it('raises AuthRequiredError when Facebook shows a login page', async () => {
    const command = getRegistry().get('facebook/marketplace-search');
    const page = makePage({ evaluate: vi.fn().mockResolvedValue({ status: 'auth', href: 'https://www.facebook.com/login/', rows: [], diagnostics: {} }) });

    await expect(command.func(page, { query: 'bike' })).rejects.toThrow(AuthRequiredError);
  });

  it('raises ArgumentError when Facebook drops an unknown location slug', async () => {
    const command = getRegistry().get('facebook/marketplace-search');
    const page = makePage({
      evaluate: vi.fn().mockResolvedValue(okPayload([CARD_BIKE], 'https://www.facebook.com/marketplace/category/search/?query=bike')),
    });

    await expect(command.func(page, { query: 'bike', location: 'eastlansing' })).rejects.toThrow(/did not recognize --location/);
  });

  it('raises EmptyResultError when no cards rendered at all', async () => {
    const command = getRegistry().get('facebook/marketplace-search');
    const page = makePage({ evaluate: vi.fn().mockResolvedValue({ status: 'no_rows', href: '', rows: [], diagnostics: { anchorCount: 0 } }) });

    await expect(command.func(page, { query: 'zzzz' })).rejects.toThrow(EmptyResultError);
  });

  it('raises CommandExecutionError when cards rendered but none parsed', async () => {
    const command = getRegistry().get('facebook/marketplace-search');
    const page = makePage({
      evaluate: vi.fn().mockResolvedValue({ status: 'ok', href: '', rows: [{ id: '1', label: 'garbage', spans: ['garbage'], image: '' }], diagnostics: { anchorCount: 1 } }),
    });

    await expect(command.func(page, { query: 'bike' })).rejects.toThrow(CommandExecutionError);
  });

  it('rejects bad arguments before touching the browser', async () => {
    const command = getRegistry().get('facebook/marketplace-search');
    const page = makePage();

    await expect(command.func(page, { query: '' })).rejects.toThrow(ArgumentError);
    await expect(command.func(page, { query: 'bike', limit: 0 })).rejects.toThrow(ArgumentError);
    await expect(command.func(page, { query: 'bike', 'min-price': 500, 'max-price': 100 })).rejects.toThrow(ArgumentError);
    await expect(command.func(page, { query: 'bike', days: 5 })).rejects.toThrow(ArgumentError);
    expect(page.goto).not.toHaveBeenCalled();
  });
});
