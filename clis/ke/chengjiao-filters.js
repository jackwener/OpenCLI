import { ArgumentError } from '@jackwener/opencli/errors';

// keyword → Beike code for chengjiao (成交记录). Anchors l3/sf1/de3/lc1 confirmed live on
// sh.ke.com/chengjiao (Task 1). The remaining codes are inherited from ershoufang's
// already-verified residential scheme on the SAME domain ({city}.ke.com): ORIENTATION,
// AGE, DECORATION, USAGE, ELEVATOR and SORT. Two of these are worth singling out as
// inherited-not-independently-confirmed-on-chengjiao (the chengjiao smoke was captcha-blocked):
//   - ELEVATOR { yes: 'ie2', no: 'ie1' } — note yes=2 (verified on ershoufang, not inverted by mistake).
//   - SORT 'co{field}{dir}' — these are field+direction codes, NOT positional tab indices, so
//     chengjiao lacking the 最新发布 tab does not renumber 总价/单价/面积.
// Verified independently where possible — this module does not import ershoufang's filters.js.
export const ORIENTATION = {
  'south-north': 'f5', south: 'f2', east: 'f1', north: 'f4', west: 'f3',
};
export const FLOOR = { low: 'lc1', mid: 'lc2', high: 'lc3' };
export const AGE = { '5': 'y1', '10': 'y2', '15': 'y3', '20': 'y4', '20+': 'y5' };
export const DECORATION = { fine: 'de1', simple: 'de2', rough: 'de3' };
export const ELEVATOR = { yes: 'ie2', no: 'ie1' };
export const USAGE = {
  residential: 'sf1', commercial: 'sf2', villa: 'sf3',
  courtyard: 'sf4', parking: 'sf5', other: 'sf6',
};
export const SORT = {
  'total-price-asc': 'co21', 'total-price-desc': 'co22',
  'unit-price-asc': 'co41', 'unit-price-desc': 'co42',
  'area-asc': 'co11', 'area-desc': 'co12',
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
  // chengjiao 房型 is one-based: 一室=l1 .. 五室=l5 (unlike zufang's zero-based l(n-1)).
  const n = Number(rooms);
  if (!Number.isInteger(n) || n < 1 || n > 5) {
    throw new ArgumentError(`--rooms must be an integer 1-5. Received: "${rooms}"`);
  }
  return `l${n}`;
}
function areaCode(kwargs) {
  const min = kwargs['min-area'];
  const max = kwargs['max-area'];
  if (!present(min) && !present(max)) return '';
  // max-only needs an explicit min (verified on the ershoufang area endpoint); default to 0.
  const lo = present(min) ? min : 0;
  return `ba${lo}ea${present(max) ? max : ''}`;
}

// Deterministic emit order (mirrors ershoufang's verified order, minus features/price).
// Beike parses codes by prefix regardless of order, so this is for clean, stable URLs.
const SEGMENT_PRODUCERS = [
  (k) => lookup(SORT, k.sort),
  (k) => lookup(USAGE, k.usage),
  (k) => lookup(DECORATION, k.decoration),
  (k) => lookup(AGE, k.age),
  (k) => lookup(FLOOR, k.floor),
  (k) => lookup(ORIENTATION, k.orientation),
  (k) => lookup(ELEVATOR, k.elevator),
  (k) => areaCode(k),
  (k) => roomsCode(k.rooms),
];

/**
 * Build the Beike chengjiao filter/sort code segment for /chengjiao/{district}/{segment}/.
 * Returns '' when no filters/sort are active.
 */
export function buildChengjiaoFilterPath(kwargs) {
  const parts = [];
  for (const produce of SEGMENT_PRODUCERS) {
    const code = produce(kwargs);
    if (code) parts.push(code);
  }
  return parts.join('');
}
