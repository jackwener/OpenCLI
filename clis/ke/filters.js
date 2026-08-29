import { ArgumentError } from '@jackwener/opencli/errors';

// keyword → Beike URL code. Values confirmed against the live site (Task 1).
export const ORIENTATION = {
  'south-north': 'f5', south: 'f2', east: 'f1', north: 'f4', west: 'f3',
};
// low=lc1 verified; mid/high (lc2/lc3) inferred from the lc-prefix pattern.
export const FLOOR = { low: 'lc1', mid: 'lc2', high: 'lc3' };
export const AGE = { '5': 'y1', '10': 'y2', '15': 'y3', '20': 'y4', '20+': 'y5' };
// de1 (精装) and de3 (毛坯) verified; de2 (普通) inferred from the de-prefix pattern.
export const DECORATION = { fine: 'de1', simple: 'de2', rough: 'de3' };
export const ELEVATOR = { yes: 'ie2', no: 'ie1' };
// 房源特色 (multi-select). Iteration order here IS the emit order.
export const FEATURES = {
  'must-see': 'tt9',
  'five-years': 'mw1',
  'two-years': 'ty1',
  'near-subway': 'su1',
  vr: 'tt8',
  'new-7d': 'tt2',
  'anytime-view': 'tt4',
};
export const USAGE = {
  residential: 'sf1', commercial: 'sf2', villa: 'sf3',
  courtyard: 'sf4', parking: 'sf6', other: 'sf5',
};
export const SORT = {
  newest: 'co32',
  'total-price-asc': 'co21',
  'total-price-desc': 'co22',
  'unit-price-asc': 'co41',
  'unit-price-desc': 'co42',
  'area-asc': 'co11',
  'area-desc': 'co12',
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
  const n = Number(rooms);
  if (!Number.isInteger(n) || n < 1 || n > 5) {
    throw new ArgumentError(`--rooms must be an integer 1-5. Received: "${rooms}"`);
  }
  return `l${n}`;
}

function priceCode(kwargs) {
  const min = kwargs['min-price'];
  const max = kwargs['max-price'];
  if (!min && !max) return '';
  return `p${min || ''}t${max || ''}`;
}

function areaCode(kwargs) {
  const min = kwargs['min-area'];
  const max = kwargs['max-area'];
  if (!present(min) && !present(max)) return '';
  // Live-verified shapes: ba70ea (=70平以上), ba0ea120 (=120平以下), ba79ea90.
  // An upper-bound-only query needs an explicit min — `baea120` is ignored by Beike,
  // so default the lower bound to 0 when only --max-area is given.
  const lo = present(min) ? min : 0;
  return `ba${lo}ea${present(max) ? max : ''}`;
}

function featuresCode(raw) {
  if (!raw) return '';
  const requested = new Set(
    String(raw).split(',').map((s) => s.trim()).filter(Boolean),
  );
  for (const key of requested) {
    if (!FEATURES[key]) {
      throw new ArgumentError(
        `unknown --features value: "${key}"`,
        `Allowed: ${Object.keys(FEATURES).join(', ')}`,
      );
    }
  }
  // emit in table-definition order, not user order
  return Object.keys(FEATURES).filter((k) => requested.has(k)).map((k) => FEATURES[k]).join('');
}

// Canonical left-to-right order Beike concatenates prefixes in. This linear order
// satisfies every captured sample:
//   co32de3l3, de3l3p1, co32mw1ie2ba79ea90l3, sf1de1y1lc1f2
// i.e. sort < {usage<decoration<age<floor<orientation} < features < elevator < area
//        < rooms < price.
// The two sample groups (usage/decoration/age/floor/orientation vs
// features/elevator/area/rooms) never co-occurred, so their interleaving is one
// evidence-consistent extension. Beike parses codes by prefix, so order does not affect
// which filters apply — confirmed by the live smoke.
const SEGMENT_PRODUCERS = [
  (k) => lookup(SORT, k.sort),
  (k) => lookup(USAGE, k.usage),
  (k) => lookup(DECORATION, k.decoration),
  (k) => lookup(AGE, k.age),
  (k) => lookup(FLOOR, k.floor),
  (k) => lookup(ORIENTATION, k.orientation),
  (k) => featuresCode(k.features),
  (k) => lookup(ELEVATOR, k.elevator),
  (k) => areaCode(k),
  (k) => roomsCode(k.rooms),
  (k) => priceCode(k),
];

/**
 * Build the Beike filter/sort code segment for /ershoufang/{district}/{segment}/.
 * Returns '' when no filters/sort are active.
 */
export function buildErshoufangFilterPath(kwargs) {
  const parts = [];
  for (const produce of SEGMENT_PRODUCERS) {
    const code = produce(kwargs);
    if (code) parts.push(code);
  }
  return parts.join('');
}
