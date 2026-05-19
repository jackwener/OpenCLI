import {
  ArgumentError,
  CommandExecutionError,
  EmptyResultError,
} from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function normalizePositiveInt(value, defaultValue, label, max) {
  const raw = value ?? defaultValue;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new ArgumentError(`${label} must be a positive integer`);
  }
  if (typeof max === 'number' && n > max) {
    throw new ArgumentError(`${label} must be <= ${max}`);
  }
  return n;
}

function normalizeNonNegativeInt(value, defaultValue, label, max) {
  const raw = value ?? defaultValue;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    throw new ArgumentError(`${label} must be a non-negative integer`);
  }
  if (typeof max === 'number' && n > max) {
    throw new ArgumentError(`${label} must be <= ${max}`);
  }
  return n;
}

function normalizeDate(value, label) {
  const v = String(value || '').trim();
  if (!v) {
    throw new ArgumentError(`${label} is required (YYYY-MM-DD)`);
  }
  if (!DATE_RE.test(v)) {
    throw new ArgumentError(`${label} must be YYYY-MM-DD, got ${JSON.stringify(value)}`);
  }
  const [year, month, day] = v.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(d.getTime()) ||
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    throw new ArgumentError(`${label} is not a valid calendar date: ${v}`);
  }
  return v;
}

function normalizeCurrency(value) {
  if (value == null || value === '') return '';
  const v = String(value).trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(v)) {
    throw new ArgumentError(`currency must be a 3-letter ISO code (e.g. USD, JPY, CNY), got ${JSON.stringify(value)}`);
  }
  return v;
}

const ALLOWED_LANGS = new Set([
  'en-us', 'en-gb', 'zh-cn', 'zh-tw', 'ja', 'ko', 'de', 'fr', 'es', 'it',
  'pt-br', 'pt-pt', 'ru', 'th', 'vi', 'tr', 'pl', 'nl', 'ar',
]);

function normalizeLang(value) {
  if (value == null || value === '') return '';
  const v = String(value).trim().toLowerCase();
  if (!ALLOWED_LANGS.has(v)) {
    throw new ArgumentError(`lang must be one of: ${[...ALLOWED_LANGS].join(', ')}`);
  }
  return v;
}

function hasPositiveResultCount(text) {
  const value = String(text || '').replace(/\u00a0/g, ' ');
  const resultCount = value.match(/\b([1-9][0-9,.\s]*)\s+(?:properties|property|stays|stay|hotels|hotel)\b/i);
  if (!resultCount) return false;
  const digits = resultCount[1].replace(/\D/g, '');
  return Boolean(digits) && Number(digits) > 0;
}

function buildSearchUrl({
  destination,
  checkin,
  checkout,
  adults,
  rooms,
  children,
  offset,
  currency,
  lang,
}) {
  const file = lang ? `searchresults.${lang}.html` : 'searchresults.html';
  const params = new URLSearchParams();
  params.set('ss', destination);
  params.set('checkin', checkin);
  params.set('checkout', checkout);
  params.set('group_adults', String(adults));
  params.set('no_rooms', String(rooms));
  params.set('group_children', String(children));
  if (offset > 0) params.set('offset', String(offset));
  if (currency) params.set('selected_currency', currency);
  return `https://www.booking.com/${file}?${params.toString()}`;
}

const EXTRACTOR = `
  (() => {
    const trim = (v) => (v == null ? '' : String(v).replace(/\\s+/g, ' ').trim());
    const cards = Array.from(document.querySelectorAll('[data-testid=property-card]'));

    // Detect blocking / captcha pages: no cards but body shows a verification prompt.
    if (cards.length === 0) {
      const text = [
        (document.title || ''),
        (document.body && document.body.innerText) || '',
        (location && location.pathname) || '',
      ].join(' ');
      const blocked = /captcha|challenge|verify\\s*you\\s*are|access\\s*denied|forbidden|robot|unusual\\s*traffic/i.test(text);
      const totalEl = document.querySelector('h1');
      const totalText = trim(totalEl && totalEl.textContent);
      return { ok: true, items: [], blocked, totalText };
    }

    const items = cards.map((card) => {
      const titleEl = card.querySelector('[data-testid=title]');
      const link = card.querySelector('a[data-testid=title-link]');
      const href = (link && link.href) || '';
      let country = '';
      let slug = '';
      let canonicalUrl = '';
      try {
        const u = new URL(href, 'https://www.booking.com');
        const m = u.pathname.match(/^\\/hotel\\/([a-z]{2})\\/([^./]+)/);
        if (m) {
          country = m[1];
          slug = m[2];
          canonicalUrl = 'https://www.booking.com/hotel/' + country + '/' + slug + '.html';
        }
      } catch (_) {}

      const reviewTextRaw = trim(card.querySelector('[data-testid=review-score]')?.textContent);
      // Booking renders the score twice (a11y + visual), text reads like "Scored 8.6 8.6 Very Good 6,151 reviews"
      // or "评分8.68.6很棒 6,151条住客点评". Take only the first numeric occurrence.
      const scoreMatch = reviewTextRaw.match(/(\\d{1,2})\\.(\\d)/);
      const reviewScore = scoreMatch ? Number(scoreMatch[1] + '.' + scoreMatch[2]) : null;

      const countMatch = reviewTextRaw.match(/([0-9][0-9,]*)\\s*(?:reviews|reseñas|avis|recensioni|条住客点评|条评论|レビュー|리뷰)/i);
      const reviewCount = countMatch ? Number(countMatch[1].replace(/,/g, '')) : null;

      // Star rating: aria-label often "5 out of 5" / "4 星 (满分 5 星)" / "Hôtel 4 étoiles"
      let starRating = null;
      const starEl = card.querySelector('[data-testid=rating-stars], [data-testid=quality-rating]');
      if (starEl) {
        const aria = starEl.getAttribute('aria-label') || starEl.textContent || '';
        const m = aria.match(/(\\d)(?:\\s*(?:out of|\\/|星|颗星|stars?|étoiles?)|\\s*$)/i);
        if (m) starRating = Number(m[1]);
        if (starRating == null) {
          const count = starEl.querySelectorAll('svg, [aria-hidden=true]').length;
          if (count >= 1 && count <= 5) starRating = count;
        }
      }

      const priceEl = card.querySelector('[data-testid=price-and-discounted-price]');
      const priceText = trim(priceEl && priceEl.textContent);

      // currency symbol → ISO best-effort
      const currencySymbolMap = {
        '$': 'USD', 'US$': 'USD', 'A$': 'AUD', 'C$': 'CAD', 'HK$': 'HKD',
        '€': 'EUR', '£': 'GBP', '¥': 'JPY', '￥': 'CNY', '₹': 'INR', '₩': 'KRW',
        'CN¥': 'CNY', 'CN￥': 'CNY', 'NT$': 'TWD', 'S$': 'SGD',
      };
      let priceCurrency = '';
      let priceAmount = null;
      const sym = priceText.match(/(US\\$|A\\$|C\\$|HK\\$|NT\\$|S\\$|CN¥|CN￥|[$€£¥￥₹₩])/);
      if (sym) priceCurrency = currencySymbolMap[sym[1]] || '';
      const num = priceText.replace(/,/g, '').match(/(\\d+(?:\\.\\d+)?)/);
      if (num) priceAmount = Number(num[1]);

      return {
        name: trim(titleEl?.textContent),
        country,
        slug,
        url: canonicalUrl,
        distance: trim(card.querySelector('[data-testid=distance]')?.textContent),
        review_score: reviewScore,
        review_count: reviewCount,
        star_rating: starRating,
        price_currency: priceCurrency,
        price_amount: priceAmount,
        recommended_room: trim(card.querySelector('[data-testid=recommended-units]')?.textContent),
      };
    });

    const totalEl = document.querySelector('h1');
    const totalText = trim(totalEl && totalEl.textContent);
    return { ok: true, items, blocked: false, totalText };
  })()
`;

cli({
  site: 'booking',
  name: 'search',
  description: 'Search Booking.com hotels by destination and dates (server-rendered card scrape).',
  access: 'read',
  example: 'opencli booking search Tokyo --checkin 2026-06-15 --checkout 2026-06-17 -f yaml',
  domain: 'www.booking.com',
  strategy: Strategy.PUBLIC,
  browser: true,
  args: [
    { name: 'destination', required: true, positional: true, help: 'Destination keyword (city, district, or hotel name)' },
    { name: 'checkin', required: true, help: 'Check-in date YYYY-MM-DD' },
    { name: 'checkout', required: true, help: 'Check-out date YYYY-MM-DD' },
    { name: 'adults', type: 'int', default: 2, help: 'Number of adults (1-30)' },
    { name: 'rooms', type: 'int', default: 1, help: 'Number of rooms (1-30)' },
    { name: 'children', type: 'int', default: 0, help: 'Number of children (0-10)' },
    { name: 'currency', required: false, help: 'Force result currency (e.g. USD, JPY, CNY)' },
    { name: 'lang', required: false, help: 'Force result language (e.g. en-us, zh-cn, ja)' },
    { name: 'limit', type: 'int', default: 25, help: 'Max rows to return (1-100; Booking pages 25 per request)' },
    { name: 'offset', type: 'int', default: 0, help: 'Result offset for pagination (multiple of 25)' },
  ],
  columns: [
    'rank',
    'name',
    'country',
    'slug',
    'star_rating',
    'review_score',
    'review_count',
    'price_amount',
    'price_currency',
    'distance',
    'recommended_room',
    'url',
  ],
  func: async (page, kwargs) => {
    const destination = String(kwargs.destination || '').trim();
    if (!destination) throw new ArgumentError('destination is required');
    const checkin = normalizeDate(kwargs.checkin, 'checkin');
    const checkout = normalizeDate(kwargs.checkout, 'checkout');
    if (checkin >= checkout) {
      throw new ArgumentError(`checkout (${checkout}) must be after checkin (${checkin})`);
    }
    const adults = normalizePositiveInt(kwargs.adults, 2, 'adults', 30);
    const rooms = normalizePositiveInt(kwargs.rooms, 1, 'rooms', 30);
    const children = normalizeNonNegativeInt(kwargs.children, 0, 'children', 10);
    const currency = normalizeCurrency(kwargs.currency);
    const lang = normalizeLang(kwargs.lang);
    const limit = normalizePositiveInt(kwargs.limit, 25, 'limit', 100);
    const offset = normalizeNonNegativeInt(kwargs.offset, 0, 'offset', 1000);

    const url = buildSearchUrl({ destination, checkin, checkout, adults, rooms, children, offset, currency, lang });

    try {
      await page.goto(url);
    } catch (err) {
      throw new CommandExecutionError(`Failed to load Booking.com search page: ${err?.message || err}`);
    }

    // Booking lazy-loads price cells; wait for at least the first card price to settle.
    try {
      await page.wait('selector', '[data-testid=property-card]', { timeoutMs: 20000 });
    } catch (_) {
      // selector wait is best-effort — extractor handles empty case explicitly
    }

    let raw;
    try {
      raw = await page.evaluate(EXTRACTOR);
    } catch (err) {
      throw new CommandExecutionError(`Failed to extract Booking.com cards: ${err?.message || err}`);
    }

    if (raw && typeof raw === 'object' && raw.data && raw.session) {
      raw = raw.data;
    }
    if (!raw || typeof raw !== 'object') {
      throw new CommandExecutionError('Booking.com page returned no extractable data');
    }
    if (raw.blocked) {
      throw new CommandExecutionError('Booking.com served a verification / captcha page; retry later or change profile');
    }

    if (raw.ok !== true) {
      throw new CommandExecutionError('Booking.com extractor returned an invalid status');
    }
    if (!Array.isArray(raw.items)) {
      throw new CommandExecutionError('Booking.com extractor returned malformed items');
    }

    const items = raw.items;
    if (items.length === 0) {
      const totalText = String(raw.totalText || '').trim();
      if (hasPositiveResultCount(totalText)) {
        throw new CommandExecutionError(
          `Booking.com page declared results but no property cards were parsed: ${totalText}`,
        );
      }
      throw new EmptyResultError(
        `booking search ${JSON.stringify(destination)}`,
        totalText
          ? `No hotels rendered (${totalText}). Try a broader destination, different dates, or check the URL in a browser.`
          : 'No hotels rendered. Try a broader destination, different dates, or check the URL in a browser.',
      );
    }

    return items.slice(0, limit).map((it, i) => {
      if (!it || typeof it !== 'object') {
        throw new CommandExecutionError('Booking.com extractor returned malformed hotel row');
      }
      const name = String(it.name || '').trim();
      const country = String(it.country || '').trim();
      const slug = String(it.slug || '').trim();
      const urlValue = String(it.url || '').trim();
      const expectedUrl = country && slug
        ? `https://www.booking.com/hotel/${country}/${slug}.html`
        : '';
      if (!name || !/^[a-z]{2}$/.test(country) || !slug || urlValue !== expectedUrl) {
        throw new CommandExecutionError('Booking.com hotel row is missing stable name/url identity');
      }
      return {
        rank: offset + i + 1,
        name,
        country,
        slug,
        star_rating: it.star_rating,
        review_score: it.review_score,
        review_count: it.review_count,
        price_amount: it.price_amount,
        price_currency: it.price_amount == null ? '' : (currency || it.price_currency || ''),
        distance: it.distance,
        recommended_room: it.recommended_room,
        url: urlValue,
      };
    });
  },
});

export const __test__ = {
  normalizePositiveInt,
  normalizeNonNegativeInt,
  normalizeDate,
  normalizeCurrency,
  normalizeLang,
  hasPositiveResultCount,
  buildSearchUrl,
  EXTRACTOR,
};
