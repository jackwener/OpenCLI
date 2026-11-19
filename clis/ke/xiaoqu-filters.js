// keyword → Beike xiaoqu code. All values verified live against sh.ke.com (Task 1).
export const AGE = { '5': 'y1', '10': 'y2', '15': 'y3', '20': 'y4', '20+': 'y5' };
export const SORT = { 'avg-price-asc': 'cro21', 'avg-price-desc': 'cro22' };
const NEAR_SUBWAY_CODE = 'su1';

function present(v) {
  return v !== undefined && v !== null && v !== '';
}
function lookup(table, key) {
  if (!present(key)) return '';
  return table[String(key)] || '';
}
function nearSubwayCode(kwargs) {
  return kwargs['near-subway'] ? NEAR_SUBWAY_CODE : '';
}
function avgPriceCode(kwargs) {
  const min = kwargs['min-price'];
  const max = kwargs['max-price'];
  if (!present(min) && !present(max)) return '';
  // Live-verified shapes: bp3ep (=3万以上), bp0ep5 (=5万以下), bp3ep5.
  // An upper-bound-only query needs an explicit min — `bpep5` is ignored by Beike,
  // so default the lower bound to 0 when only --max-price is given.
  const lo = present(min) ? min : 0;
  return `bp${lo}ep${present(max) ? max : ''}`;
}

// Deterministic emit order. Beike parses xiaoqu codes by prefix regardless of order
// (verified live: cro21y2su1 applied all three filters), so this order is for clean,
// stable URLs.
const SEGMENT_PRODUCERS = [
  (k) => lookup(SORT, k.sort),
  (k) => lookup(AGE, k.age),
  (k) => nearSubwayCode(k),
  (k) => avgPriceCode(k),
];

/**
 * Build the Beike xiaoqu filter/sort code segment for /xiaoqu/{district}/{segment}/.
 * Returns '' when no filters/sort are active.
 */
export function buildXiaoquFilterPath(kwargs) {
  const parts = [];
  for (const produce of SEGMENT_PRODUCERS) {
    const code = produce(kwargs);
    if (code) parts.push(code);
  }
  return parts.join('');
}
