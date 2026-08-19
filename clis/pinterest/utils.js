// Shared helpers for Pinterest adapters.
// Resources are POST /resource/<Name>Resource/{get,create}/ with a form-urlencoded body
// and the X-CSRFToken + X-Pinterest-PWS-Handler headers; feeds paginate via `bookmark`.
import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';

export const PINTEREST_DOMAIN = 'www.pinterest.com';
export const PINTEREST_BASE = 'https://www.pinterest.com';
export const DEFAULT_PAGE_SIZE = 25;

/** Any valid handler value passes; the server only rejects missing/garbage ones. */
const PWS_HANDLER = 'www/[username]/[slug].js';

/** Resource actions that mutate; only these treat a 403 as "you need to log in". */
const WRITE_ACTIONS = new Set(['create', 'update', 'delete']);

/** Unwrap the { session, data } envelope some browser-bridge versions add. */
export function unwrapEvaluateResult(payload) {
  const isEnvelope = payload
    && typeof payload === 'object'
    && !Array.isArray(payload)
    && 'session' in payload
    && 'data' in payload;
  return isEnvelope ? payload.data : payload;
}

/** Validate a positive-integer limit (throws instead of silently clamping). */
export function requireLimit(value, { fallback, max, name = 'limit' }) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ArgumentError(`${name} must be a positive integer`, `e.g. --${name} 10`);
  }
  if (max && parsed > max) {
    throw new ArgumentError(`${name} must be <= ${max}`, `Lower --${name} to ${max} or below`);
  }
  return parsed;
}

/**
 * Fold a slug for comparison. Pinterest keeps non-ASCII characters in slugs (e.g.
 * `naive-café-中文`) and stores them NFC, but a pasted or keyboard-composed accent can arrive as
 * NFD, which compares unequal byte-wise.
 */
export function normalizeForMatch(value) {
  return String(value ?? '').normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Pinterest path prefixes that are site routes, not usernames. Without this a pin URL parses as
 * the board `pin/<id>` and fails with a confusing "could not resolve board".
 */
const RESERVED_PATH_ROOTS = new Set(['pin', 'search', 'ideas', 'today', 'settings', '_saved', 'news_hub', 'business']);

/** Percent-decode one path segment; a malformed escape is left as-is rather than throwing. */
function decodeSegment(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Parse a board URL or <username>/<slug> into { username, slug, path }.
 * Returns null for anything else (e.g. a bare board id, which needs an API lookup).
 */
export function tryParseBoardRef(raw) {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return null;
  let pathname = trimmed;
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      pathname = new URL(trimmed).pathname;
    } catch {
      throw new ArgumentError(`Invalid board URL: ${trimmed}`, 'Use a full board URL like https://www.pinterest.com/janedoe/my-board/');
    }
  }
  // Pinterest percent-encodes non-ASCII slugs in the URLs it hands out; the API wants them decoded.
  const parts = pathname.split('/').filter(Boolean).map(decodeSegment);
  if (parts.length < 2) return null;
  const [username, slug] = parts;
  if (RESERVED_PATH_ROOTS.has(username.toLowerCase())) {
    throw new ArgumentError(
      `"${raw}" is a Pinterest /${username}/ URL, not a board`,
      username.toLowerCase() === 'pin'
        ? 'Pass the board this pin lives on, e.g. janedoe/my-board (`opencli pinterest pin <id>` reports it)'
        : 'Pass <username>/<slug>, a board URL, or a numeric board id',
    );
  }
  return { username, slug, path: `/${username}/${slug}/` };
}

/** Normalize a username or profile URL to a bare username (Pinterest has no @-handles). */
export function parseUsername(raw) {
  let value = String(raw ?? '').trim();
  if (!value) throw new ArgumentError('username is required', 'Pass a Pinterest username or profile URL, e.g. janedoe');
  if (/^https?:\/\//i.test(value)) {
    try {
      value = decodeSegment(new URL(value).pathname.split('/').filter(Boolean)[0] || '');
    } catch {
      throw new ArgumentError(`Invalid profile URL: ${raw}`, 'Use a full profile URL like https://www.pinterest.com/janedoe/');
    }
  }
  value = value.replace(/^\/+|\/+$/g, '');
  if (!value) throw new ArgumentError(`Not a username: "${raw}"`, 'Pass the bare username, e.g. janedoe');
  if (value.includes('/')) {
    throw new ArgumentError(
      `Not a username: "${raw}"`,
      'This looks like a board or pin reference — pass just the username, e.g. janedoe',
    );
  }
  if (value.startsWith('@')) {
    throw new ArgumentError(`Pinterest usernames have no "@": "${raw}"`, 'Drop the @ and use the bare username, e.g. janedoe');
  }
  return value;
}

/** Parse a bare pin id or a /pin/<id>/ URL. */
export function parsePinId(raw) {
  const value = String(raw ?? '').trim();
  if (!value) throw new ArgumentError('pin id is required', 'Pass a pin id or /pin/<id>/ URL, e.g. 1234567890123456');
  if (/^\d+$/.test(value)) return value;
  const match = value.match(/\/pin\/(\d+)/);
  if (match) return match[1];
  throw new ArgumentError(`Not a pin id or pin URL: "${raw}"`, 'Expected a numeric id or a /pin/<id>/ URL, e.g. 1234567890123456');
}

/** Highest-resolution image URL available for a pin. */
export function pickPinImage(images) {
  if (!images || typeof images !== 'object') return '';
  for (const key of ['orig', '736x', '564x', '474x', '236x']) {
    const candidate = images[key];
    if (candidate && candidate.url) return candidate.url;
  }
  return '';
}

/** Map a raw pin to the shared grid-row shape used by list commands. */
export function toPinRow(pin) {
  const id = String(pin.id ?? '');
  return {
    pinId: id,
    title: (pin.title || pin.grid_title || '').trim(),
    description: (typeof pin.description === 'string' ? pin.description : '').trim(),
    pinner: (pin.pinner && pin.pinner.username) || '',
    board: (pin.board && pin.board.name) || '',
    imageUrl: pickPinImage(pin.images),
    url: id ? `${PINTEREST_BASE}/pin/${id}/` : '',
  };
}

/** In-page fetch for a resource action; values are JSON-encoded so input can't break out. */
function resourceFetchScript(url, body) {
  return `
    (async () => {
      // page.goto can resolve before Pinterest has set csrftoken, and posting without it is a
      // 403. Wait for the cookie instead of firing a request that is guaranteed to be rejected.
      const readCsrf = () => (document.cookie.match(/csrftoken=([^;]+)/) || [])[1] || '';
      let csrf = readCsrf();
      for (let i = 0; i < 30 && !csrf; i++) {
        await new Promise((r) => setTimeout(r, 100));
        csrf = readCsrf();
      }
      if (!csrf) return { __noCsrf: true };
      try {
        const resp = await fetch(${JSON.stringify(url)}, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-CSRFToken': csrf,
            'X-Pinterest-PWS-Handler': ${JSON.stringify(PWS_HANDLER)},
          },
          body: ${JSON.stringify(body)},
        });
        const text = await resp.text();
        if (!resp.ok) {
          let apiMessage = '';
          try {
            const rr = JSON.parse(text).resource_response;
            apiMessage = (rr && ((rr.error && rr.error.message) || rr.message)) || '';
          } catch {}
          return { __httpError: resp.status, message: apiMessage || text.slice(0, 200) };
        }
        try { return JSON.parse(text); } catch { return { __malformed: true }; }
      } catch (err) {
        return { __fetchError: (err && err.message) || String(err) };
      }
    })()
  `;
}

/** POST a resource action ('get' | 'create' | 'update' | 'delete'); returns { data, results, bookmark }. */
export async function pinterestResourceFetch(page, resource, options, sourceUrl, action = 'get') {
  const data = JSON.stringify({ options, context: {} });
  const body = `source_url=${encodeURIComponent(sourceUrl)}&data=${encodeURIComponent(data)}`;
  const url = `/resource/${resource}/${action}/`;

  const raw = unwrapEvaluateResult(await page.evaluate(resourceFetchScript(url, body)));

  if (raw?.__fetchError) {
    throw new CommandExecutionError(`Pinterest request failed: ${raw.__fetchError}`);
  }
  if (raw?.__noCsrf) {
    throw new CommandExecutionError(
      'Pinterest did not set a csrftoken cookie for this page',
      'Open https://www.pinterest.com in Chrome (logged in) and retry',
    );
  }
  if (raw?.__httpError) {
    const status = raw.__httpError;
    // Reads work anonymously, so their 403 is a rejected request, not a login prompt;
    // writes genuinely need login, so treat their 403 as auth too.
    if (status === 401 || (WRITE_ACTIONS.has(action) && status === 403)) {
      // Pinterest also answers 401 for writes it refuses on a logged-in session (e.g. editing the
      // link of a scraped pin), so pass its own message through instead of only saying "log in".
      throw new AuthRequiredError(
        PINTEREST_DOMAIN,
        raw.message
          ? `Pinterest refused this write: ${raw.message}`
          : 'This action requires being logged in to Pinterest in Chrome',
      );
    }
    const hint = status === 403 ? ' (missing or expired CSRF token — reload Pinterest in Chrome)' : '';
    // Surface Pinterest's own error text (from resource_response.error.message) when present.
    const detail = raw.message ? `: ${raw.message}` : '';
    throw new CommandExecutionError(`Pinterest request failed (HTTP ${status})${detail}${hint}`);
  }
  if (!raw || typeof raw !== 'object' || raw.__malformed) {
    throw new CommandExecutionError('Pinterest request returned malformed JSON payload');
  }
  const resourceResponse = raw.resource_response;
  if (!resourceResponse || typeof resourceResponse !== 'object') {
    throw new CommandExecutionError('Pinterest request returned malformed API payload');
  }
  const payload = resourceResponse.data;
  const results = Array.isArray(payload)
    ? payload
    : (payload && Array.isArray(payload.results) ? payload.results : []);
  return { data: payload, results, bookmark: resourceResponse.bookmark || null };
}

/** POST a /create/ mutation; returns the created resource_response.data. */
export async function pinterestResourceCreate(page, resource, options, sourceUrl) {
  const { data } = await pinterestResourceFetch(page, resource, options, sourceUrl, 'create');
  return data;
}

/** POST an /update/ mutation; returns the updated resource_response.data. */
export async function pinterestResourceUpdate(page, resource, options, sourceUrl) {
  const { data } = await pinterestResourceFetch(page, resource, options, sourceUrl, 'update');
  return data;
}

/** POST a /delete/ mutation; resolves once the request succeeds (data is usually null). */
export async function pinterestResourceDelete(page, resource, options, sourceUrl) {
  const { data } = await pinterestResourceFetch(page, resource, options, sourceUrl, 'delete');
  return data;
}

/**
 * Resolve a board ref to its numeric id (the write endpoints need the id, not the slug).
 * Pass `preloaded` — the board `resolveBoardTarget` already fetched — to skip the extra request.
 */
export async function resolveBoardId(page, username, slug, path, preloaded = null) {
  const board = preloaded && preloaded.id
    ? preloaded
    : (await pinterestResourceFetch(page, 'BoardResource', { username, slug, field_set_key: 'detailed' }, path)).data;
  const boardId = board && board.id;
  if (!boardId) {
    throw new CommandExecutionError(`Could not resolve board "${username}/${slug}" (does it exist and do you own it?)`);
  }
  return { boardId: String(boardId), board };
}

/**
 * Resolve a board argument to { username, slug, path }, accepting a full board URL,
 * <username>/<slug>, or a numeric board id (which BoardResource can look up directly).
 * Display names are deliberately not accepted: a name cannot say whose board it is.
 */
export async function resolveBoardTarget(page, raw) {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) throw new ArgumentError('board is required', 'Pass <username>/<slug>, a board URL, or a numeric board id');

  const direct = tryParseBoardRef(trimmed);
  if (direct) return { ...direct, board: null };

  if (!/^\d+$/.test(trimmed)) {
    throw new ArgumentError(
      `Not a board reference: "${trimmed}"`,
      'Expected <username>/<slug>, a board URL, or a numeric board id (from `board-pins`/`user-boards`)',
    );
  }

  await page.goto(`${PINTEREST_BASE}/`);
  const { data: board } = await pinterestResourceFetch(
    page,
    'BoardResource',
    { board_id: trimmed, field_set_key: 'detailed' },
    '/',
  );
  const url = board && board.url;
  if (!url) {
    throw new ArgumentError(`No board with id "${trimmed}"`, 'Check the id with `opencli pinterest user-boards <username>`');
  }
  const parts = decodeSegment(url).split('/').filter(Boolean);
  if (parts.length < 2) {
    throw new CommandExecutionError(`Board ${trimmed} returned an unusable url: ${url}`);
  }
  // Hand the fetched board back so callers do not re-request what we already have.
  return { username: parts[0], slug: parts[1], path: `/${parts[0]}/${parts[1]}/`, board };
}

/**
 * Resolve a --section value against the board's real sections, accepting an id or a slug.
 * Pinterest ignores an unknown section silently, so an unmatched value must fail here.
 * Returns { sectionId, title, slug }.
 */
export async function resolveSection(page, boardId, sectionValue, sourceUrl) {
  const wanted = String(sectionValue ?? '').trim();
  const { results } = await pinterestResourceFetch(page, 'BoardSectionsResource', { board_id: String(boardId) }, sourceUrl);
  const sections = results.filter((section) => section && section.id);
  if (sections.length === 0) {
    throw new ArgumentError(`Board has no sections, so --section "${wanted}" cannot be used`, 'Create one first with `opencli pinterest board-section-create`');
  }
  const folded = normalizeForMatch(wanted);
  const match = sections.find((section) => String(section.id) === wanted)
    || sections.find((section) => normalizeForMatch(section.slug) === folded);
  if (!match) {
    const available = sections.map((section) => `${section.slug || '(no slug)'} (${section.id})`).join(', ');
    throw new ArgumentError(`No section matching "${wanted}" on this board`, `Pass a section slug or id — available: ${available}`);
  }
  return { sectionId: String(match.id), title: (match.title || '').trim(), slug: match.slug || '' };
}

/**
 * Move an existing pin into a board section.
 * The create endpoints (PinResource/create, RepinResource/create) accept a section key, answer
 * HTTP 200, and file the pin at the board root anyway — only PinResource/update honours it. So
 * callers that create a pin have to follow up with this second request.
 */
export async function movePinToSection(page, pinId, boardId, sectionId, sourceUrl) {
  try {
    await pinterestResourceUpdate(
      page,
      'PinResource',
      { id: String(pinId), board_id: String(boardId), board_section_id: String(sectionId) },
      sourceUrl,
    );
  } catch (err) {
    throw new CommandExecutionError(
      `Pin ${pinId} was created but could not be moved into section ${sectionId}: ${err.message}`,
      `The pin is on the board root — move it with \`opencli pinterest pin-update ${pinId} --board <board> --section ${sectionId}\``,
    );
  }
}

/** Page a feed via bookmark until `limit` rows; mapItem returns a row or null to skip. */
export async function collectResults(
  page,
  { resource, baseOptions, sourceUrl, limit, keyField, mapItem, pageSize = 25, maxPages = 12 },
) {
  const rows = [];
  const seen = new Set();
  let bookmark = null;

  for (let pageIndex = 0; pageIndex < maxPages && rows.length < limit; pageIndex++) {
    const options = { ...baseOptions, page_size: pageSize };
    if (bookmark) options.bookmarks = [bookmark];

    const { results, bookmark: next } = await pinterestResourceFetch(page, resource, options, sourceUrl);

    for (const item of results) {
      const row = mapItem(item);
      if (!row) continue;
      const key = String(row[keyField] ?? '');
      if (!key || seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
      if (rows.length >= limit) break;
    }

    if (!next || next === bookmark || next === '-end-') break;
    bookmark = next;
  }

  return rows;
}

/** collectResults specialised to organic pins (drops ads and non-pin items). */
export function collectPins(page, opts) {
  return collectResults(page, {
    ...opts,
    keyField: 'pinId',
    mapItem: (pin) => (pin && pin.type === 'pin' && !pin.is_promoted ? toPinRow(pin) : null),
  });
}
