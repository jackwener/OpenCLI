import {
  ArgumentError,
  AuthRequiredError,
  CommandExecutionError,
  EmptyResultError,
} from '@jackwener/opencli/errors';

export const BASE_URL = 'https://www.chanmama.com';
export const SENTINEL = -2147483648;

export {
  ArgumentError,
  AuthRequiredError,
  CommandExecutionError,
  EmptyResultError,
};

export function requireId(value) {
  const id = String(value || '').trim();
  if (!id) throw new ArgumentError('id is required');
  if (!/^[A-Za-z0-9_-]{8,}$/.test(id)) throw new ArgumentError('id is not a valid ChanMama id');
  return id;
}

export function integerInRange(value, name, min, max) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new ArgumentError(`${name} must be an integer between ${min} and ${max}`);
  }
  return number;
}

export function cleanNumber(value) {
  if (value === null || value === undefined || value === '' || value === '-') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number === SENTINEL) return null;
  return number;
}

export function metric(record, field) {
  const raw = cleanNumber(record?.[field]);
  const estimate = cleanNumber(record?.[`${field}_text_cmm_ind`]);
  const band = record?.[`${field}_text`] ?? null;
  if (estimate !== null && (raw === null || raw === 0 || String(band || '').includes('~') || String(band || '').includes('+'))) {
    return { value: estimate, valueType: 'estimated', band };
  }
  if (raw !== null) return { value: raw, valueType: 'exact', band };
  if (band && !['0', '-', '**'].includes(String(band))) return { value: null, valueType: 'range', band };
  return { value: null, valueType: 'masked', band };
}

export function categoryPath(category) {
  return ['big', 'first', 'second', 'third', 'fourth', 'fifth']
    .map((key) => category?.[key])
    .filter(Boolean)
    .join(' > ') || null;
}

export function categoryLevels(category) {
  const entries = ['big', 'first', 'second', 'third', 'fourth', 'fifth']
    .map((key, index) => ({ level: index + 1, id: cleanNumber(category?.[`${key}_id`]), name: category?.[key] || null }))
    .filter((item) => item.name);
  return {
    levels: entries,
    leafId: entries.at(-1)?.id ?? null,
    leafName: entries.at(-1)?.name ?? null,
  };
}

export function isoTime(value) {
  const number = cleanNumber(value);
  if (number === null) return null;
  const millis = number > 1e12 ? number : number * 1000;
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function shanghaiDate(value) {
  const number = cleanNumber(value);
  if (number === null) return null;
  const millis = number > 1e12 ? number : number * 1000;
  const date = new Date(millis);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

export function capturedAt() {
  return new Date().toISOString();
}

export function douyinContentId(value) {
  const match = String(value || '').match(/\/(?:share\/)?(?:video|note)\/(\d+)/);
  return match?.[1] || null;
}

export function stableDouyinUrl(value) {
  const match = String(value || '').match(/\/(?:share\/)?(video|note)\/(\d+)/);
  return match ? `https://www.douyin.com/${match[1]}/${match[2]}` : null;
}

export async function assertChanMamaPage(page) {
  const state = await page.evaluate(`() => ({
    url: location.href,
    title: document.title,
    text: (document.body?.innerText || '').slice(0, 600)
  })`);
  if (/login|passport/i.test(state?.url || '') || /登录后|请登录/.test(state?.text || '')) {
    throw new AuthRequiredError('chanmama.com');
  }
  if (!/chanmama\.com/.test(state?.url || '')) {
    throw new CommandExecutionError(`ChanMama page did not load: ${state?.title || state?.url || 'unknown'}`);
  }
}

export async function gotoDetail(page, id, tab = '') {
  const url = `${BASE_URL}/promotionDetail/${encodeURIComponent(id)}${tab ? `?activeTab=${encodeURIComponent(tab)}` : ''}`;
  await page.goto(url);
  await page.wait(3);
  await assertChanMamaPage(page);
  return url;
}

export async function gotoVideoDetail(page, id) {
  const url = `${BASE_URL}/awemeRank/${encodeURIComponent(id)}.html`;
  await page.goto(url);
  await page.wait(3);
  await assertChanMamaPage(page);
  return url;
}

export async function gotoAuthorDetail(page, id, tab = '') {
  const url = `${BASE_URL}/bloggerRank/${encodeURIComponent(id)}.html${tab ? `?activeTab=${encodeURIComponent(tab)}` : ''}`;
  await page.goto(url);
  await page.wait(3);
  await assertChanMamaPage(page);
  return url;
}

export async function poll(page, read, ready, attempts = 12) {
  let value = null;
  for (let index = 0; index < attempts; index += 1) {
    value = await read();
    if (ready(value)) return value;
    await page.wait(1);
  }
  return value;
}
