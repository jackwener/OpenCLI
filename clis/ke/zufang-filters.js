import { ArgumentError } from '@jackwener/opencli/errors';

// keyword → Beike zu.ke.com code. All values verified live against sh.zu.ke.com (Task 1).
export const RENT_TYPE = { whole: 'rt200600000001', shared: 'rt200600000002' };
export const ORIENTATION = {
  'south-north': 'f100500000009',
  south: 'f100500000003',
  east: 'f100500000001',
  north: 'f100500000007',
  west: 'f100500000005',
};
// 特色 (multi-select). Iteration order here IS the emit order.
export const FEATURES = {
  'near-subway': 'su1',
  'bag-in': 'bc1',
  fine: 'de1',
  'deposit-one': 'rpw1',
  new: 'in1',
  certified: 'ht1',
  'anytime-view': 'hk1',
  vr: 'vr1',
  'owner-rec': 'orec1',
};
export const LEASE_TERM = {
  monthly: 'rmp1',
  yearly: 'rmp2',
  'min-1month': 'rmp3',
  '1-3months': 'rmp4',
  '4-6months': 'rmp5',
};
export const FLOOR = { low: 'lc200500000003', mid: 'lc200500000002', high: 'lc200500000001' };
export const ELEVATOR = { yes: 'ie1', no: 'ie0' };
export const SORT = {
  newest: 'rco11',
  'rent-asc': 'rco21',
  'rent-desc': 'rco22',
  'area-asc': 'rco31',
  'area-desc': 'rco32',
};

function present(v) {
  return v !== undefined && v !== null && v !== '';
}
function lookup(table, key) {
  if (!present(key)) return '';
  return table[String(key)] || '';
}
function roomsCode(rooms) {
  if (!present(rooms)) return '';
  // zufang 户型 is zero-based: 一居=l0, 两居=l1, 三居=l2, 四居+=l3.
  const n = Number(rooms);
  if (!Number.isInteger(n) || n < 1 || n > 4) {
    throw new ArgumentError(`--rooms must be an integer 1-4 (4 = 四居+). Received: "${rooms}"`);
  }
  return `l${n - 1}`;
}
function rentCode(kwargs) {
  // Unchanged from the original zufang.js — kept exactly as-is per the spec.
  const min = kwargs['min-price'];
  const max = kwargs['max-price'];
  if (!min && !max) return '';
  return `rp${min || ''}t${max || ''}`;
}
function featuresCode(raw) {
  if (!raw) return '';
  const requested = new Set(String(raw).split(',').map((s) => s.trim()).filter(Boolean));
  for (const key of requested) {
    if (!FEATURES[key]) {
      throw new ArgumentError(
        `unknown --features value: "${key}"`,
        `Allowed: ${Object.keys(FEATURES).join(', ')}`,
      );
    }
  }
  return Object.keys(FEATURES).filter((k) => requested.has(k)).map((k) => FEATURES[k]).join('');
}

// Deterministic emit order. Beike parses zufang codes by prefix regardless of order
// (verified live), so this order is for clean, stable URLs; it follows the canonical
// grouping captured in Task 1: floor/elevator/lease < features < sort < rent-type
// < orientation < rooms, with the rent range last.
const SEGMENT_PRODUCERS = [
  (k) => lookup(FLOOR, k.floor),
  (k) => lookup(ELEVATOR, k.elevator),
  (k) => lookup(LEASE_TERM, k['lease-term']),
  (k) => featuresCode(k.features),
  (k) => lookup(SORT, k.sort),
  (k) => lookup(RENT_TYPE, k['rent-type']),
  (k) => lookup(ORIENTATION, k.orientation),
  (k) => roomsCode(k.rooms),
  (k) => rentCode(k),
];

/**
 * Build the Beike zufang filter/sort code segment for /zufang/{district}/{segment}/.
 * Returns '' when no filters/sort are active.
 */
export function buildZufangFilterPath(kwargs) {
  const parts = [];
  for (const produce of SEGMENT_PRODUCERS) {
    const code = produce(kwargs);
    if (code) parts.push(code);
  }
  return parts.join('');
}
