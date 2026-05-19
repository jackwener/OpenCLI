import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

export const RIGHTMOVE_ORIGIN = 'https://www.rightmove.co.uk';
export const LOS_ORIGIN = 'https://los.rightmove.co.uk';
export const SEARCH_COLUMNS = [
    'rank',
    'id',
    'address',
    'price',
    'bedrooms',
    'bathrooms',
    'type',
    'agent',
    'added',
    'latitude',
    'longitude',
    'url',
];

export const SORT_TYPES = {
    highest: '2',
    lowest: '1',
    newest: '6',
    oldest: '10',
};

const DEFAULT_HEADERS = {
    'User-Agent': 'Mozilla/5.0',
    Accept: 'application/json',
    'Accept-Language': 'en-GB,en;q=0.9',
};

export function requireLocationQuery(value) {
    const query = String(value ?? '').trim();
    if (!query) throw new ArgumentError('location is required unless --bbox or --polygon is provided');
    return query;
}

export function normalizePositiveInt(value, defaultValue, max, name) {
    const raw = value ?? defaultValue;
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0) throw new ArgumentError(`${name} must be a positive integer`);
    if (n > max) throw new ArgumentError(`${name} must be <= ${max}`);
    return n;
}

export function normalizeIndex(value) {
    const n = Number(value ?? 0);
    if (!Number.isInteger(n) || n < 0) throw new ArgumentError('index must be a non-negative integer');
    if (n % 24 !== 0) throw new ArgumentError('index must be a Rightmove page offset multiple of 24');
    return n;
}

export function normalizeOptionalInt(value, name) {
    if (value === undefined || value === null || value === '' || value === 0 || value === '0') return '';
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0) throw new ArgumentError(`${name} must be a non-negative integer`);
    return String(n);
}

export function normalizeRadius(value) {
    const raw = value ?? '0.0';
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) throw new ArgumentError('radius must be a non-negative number');
    if (n > 40) throw new ArgumentError('radius must be <= 40 miles');
    return n === 0 ? '0.0' : String(n);
}

export function normalizeSort(value) {
    const key = String(value ?? 'highest').toLowerCase();
    const sort = SORT_TYPES[key];
    if (!sort) throw new ArgumentError(`sort must be one of: ${Object.keys(SORT_TYPES).join(', ')}`);
    return sort;
}

export function normalizeChannel(value) {
    const key = String(value ?? 'buy').toLowerCase();
    if (key === 'buy' || key === 'sale') return 'BUY';
    if (key === 'rent' || key === 'let') return 'RENT';
    throw new ArgumentError('channel must be buy or rent');
}

export function parseBool(value, defaultValue = false) {
    if (value === undefined || value === null || value === '') return defaultValue;
    if (typeof value === 'boolean') return value;
    const text = String(value).toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(text)) return true;
    if (['false', '0', 'no', 'off'].includes(text)) return false;
    throw new ArgumentError('include-sstc must be a boolean');
}

export function normalizeBbox(value) {
    if (value === undefined || value === null || value === '') return '';
    const parts = String(value).split(',').map((p) => Number(p.trim()));
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
        throw new ArgumentError('bbox must be west,east,north,south');
    }
    const [west, east, north, south] = parts;
    if (west < -180 || west > 180 || east < -180 || east > 180) {
        throw new ArgumentError('bbox longitude values must be between -180 and 180');
    }
    if (north < -90 || north > 90 || south < -90 || south > 90) {
        throw new ArgumentError('bbox latitude values must be between -90 and 90');
    }
    if (west >= east) throw new ArgumentError('bbox west must be less than east');
    if (south >= north) throw new ArgumentError('bbox south must be less than north');
    return `${west},${east},${north},${south}`;
}

export function encodePolyline(points) {
    let lastLat = 0;
    let lastLng = 0;
    let out = '';
    const encodeDelta = (delta) => {
        let value = delta < 0 ? ~(delta << 1) : (delta << 1);
        let chunk = '';
        while (value >= 0x20) {
            chunk += String.fromCharCode((0x20 | (value & 0x1f)) + 63);
            value >>= 5;
        }
        return chunk + String.fromCharCode(value + 63);
    };

    for (const [lat, lng] of points) {
        const scaledLat = Math.round(lat * 1e5);
        const scaledLng = Math.round(lng * 1e5);
        out += encodeDelta(scaledLat - lastLat);
        out += encodeDelta(scaledLng - lastLng);
        lastLat = scaledLat;
        lastLng = scaledLng;
    }
    return out;
}

export function normalizePolygon(value) {
    if (value === undefined || value === null || value === '') return '';
    const raw = String(value).trim();
    if (!raw) return '';

    if (raw.startsWith('[')) {
        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch {
            throw new ArgumentError('polygon JSON must be an array of [lat,lng] points');
        }
        return encodePolygonPoints(parsed);
    }

    if (raw.includes(';')) {
        const points = raw.split(';').map((part) => part.split(',').map((n) => Number(n.trim())));
        return encodePolygonPoints(points);
    }

    return raw;
}

function encodePolygonPoints(points) {
    if (!Array.isArray(points) || points.length < 3) {
        throw new ArgumentError('polygon must contain at least 3 points');
    }
    const normalized = points.map((point) => {
        if (!Array.isArray(point) || point.length !== 2) {
            throw new ArgumentError('polygon points must be [lat,lng] pairs');
        }
        const lat = Number(point[0]);
        const lng = Number(point[1]);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            throw new ArgumentError('polygon coordinates must be numbers');
        }
        if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
            throw new ArgumentError('polygon coordinates are out of range');
        }
        return [lat, lng];
    });
    return encodePolyline(normalized);
}

export async function resolveLocationIdentifier(query) {
    const url = new URL('/typeahead', LOS_ORIGIN);
    url.searchParams.set('query', query);
    url.searchParams.set('limit', '10');
    url.searchParams.set('exclude', 'STREET');

    const data = await fetchJson(url, 'rightmove location lookup');
    if (!data || typeof data !== 'object' || !Array.isArray(data.matches)) {
        throw new CommandExecutionError('rightmove location lookup returned an unexpected response shape');
    }
    const matches = data.matches;
    const match = matches[0];
    if (!match) {
        throw new EmptyResultError('rightmove search', `No Rightmove location matched "${query}"`);
    }
    if (!match.id || !match.type) {
        throw new CommandExecutionError('rightmove location lookup returned a match without id/type');
    }
    return {
        id: String(match.id),
        type: String(match.type),
        displayName: String(match.displayName ?? query),
        identifier: `${match.type}^${match.id}`,
    };
}

export function buildSearchUrl(opts) {
    const url = new URL('/api/property-search/listing/search', RIGHTMOVE_ORIGIN);
    url.searchParams.set('sortType', opts.sortType);
    url.searchParams.set('areaSizeUnit', 'sqft');
    url.searchParams.set('viewType', 'LIST');
    url.searchParams.set('channel', opts.channel);
    url.searchParams.set('transactionType', opts.channel);
    url.searchParams.set('index', String(opts.index));
    url.searchParams.set('locationIdentifier', opts.locationIdentifier);
    url.searchParams.set('numberOfPropertiesPerPage', String(opts.limit));
    if (opts.searchLocation) {
        url.searchParams.set('searchLocation', opts.searchLocation);
        url.searchParams.set('useLocationIdentifier', 'true');
    }
    if (opts.displayLocationIdentifier) {
        url.searchParams.set('displayLocationIdentifier', opts.displayLocationIdentifier);
    }
    if (opts.radius) url.searchParams.set('radius', opts.radius);
    if (opts.includeSstc) url.searchParams.set('_includeSSTC', 'on');
    if (opts.minPrice) url.searchParams.set('minPrice', opts.minPrice);
    if (opts.maxPrice) url.searchParams.set('maxPrice', opts.maxPrice);
    if (opts.minBeds) url.searchParams.set('minBedrooms', opts.minBeds);
    if (opts.maxBeds) url.searchParams.set('maxBedrooms', opts.maxBeds);
    return url;
}

export async function fetchSearchResults(url) {
    const data = await fetchJson(url, 'rightmove search');
    if (!Array.isArray(data?.properties)) {
        throw new CommandExecutionError('rightmove search returned an unexpected response');
    }
    if (data.properties.length === 0) {
        throw new EmptyResultError('rightmove search', 'Rightmove returned no properties for this search');
    }
    return data;
}

async function fetchJson(url, label) {
    let resp;
    try {
        resp = await fetch(url, { headers: DEFAULT_HEADERS });
    } catch (error) {
        throw new CommandExecutionError(`${label} request failed: ${error?.message || error}`);
    }
    if (!resp.ok) throw new CommandExecutionError(`${label} failed: HTTP ${resp.status}`);
    try {
        return await resp.json();
    } catch (error) {
        throw new CommandExecutionError(`${label} returned malformed JSON: ${error?.message || error}`);
    }
}

export function buildLocationIdentifier({ query, bbox, polygon }) {
    if (bbox && polygon) throw new ArgumentError('--bbox and --polygon cannot be used together');
    if (bbox) {
        return {
            identifier: `LAT_LONG_BOX^${bbox}`,
            displayName: 'bounding box',
            searchLocation: '',
            displayLocationIdentifier: 'undefined',
        };
    }
    if (polygon) {
        return {
            identifier: `USERDEFINEDAREA^${JSON.stringify({ polylines: polygon })}`,
            displayName: 'user-defined area',
            searchLocation: '',
            displayLocationIdentifier: 'undefined',
        };
    }
    return resolveLocationIdentifier(requireLocationQuery(query));
}

export function propertyToRow(property, rank) {
    const id = property?.id;
    const idText = String(id ?? '').trim();
    const rawUrl = property?.propertyUrl ? String(property.propertyUrl).trim() : '';
    if (!idText || !rawUrl) {
        throw new CommandExecutionError(`rightmove search result at rank ${rank} did not include a round-trippable id and propertyUrl`);
    }
    let url;
    try {
        url = new URL(rawUrl, RIGHTMOVE_ORIGIN);
    } catch {
        throw new CommandExecutionError(`rightmove search result at rank ${rank} had an invalid propertyUrl`);
    }
    const pathId = url.pathname.match(/^\/properties\/([^/?#]+)/)?.[1];
    if (url.origin !== RIGHTMOVE_ORIGIN || !pathId || pathId !== idText) {
        throw new CommandExecutionError(`rightmove search result at rank ${rank} had a non-round-trippable propertyUrl`);
    }
    const price = property?.price?.displayPrices?.[0]?.displayPrice
        ?? (property?.price?.amount ? String(property.price.amount) : '');
    const agent = property?.customer?.branchDisplayName
        ?? property?.formattedBranchName
        ?? '';
    return {
        rank,
        id,
        address: property?.displayAddress ?? '',
        price,
        bedrooms: property?.bedrooms ?? '',
        bathrooms: property?.bathrooms ?? '',
        type: property?.propertyTypeFullDescription ?? property?.propertySubType ?? '',
        agent: String(agent).replace(/^\s*by\s+/i, '').trim(),
        added: property?.addedOrReduced ?? property?.listingUpdate?.listingUpdateReason ?? '',
        latitude: property?.location?.latitude ?? '',
        longitude: property?.location?.longitude ?? '',
        url: url.href,
    };
}
