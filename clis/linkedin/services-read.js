import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import {
  assertLinkedInAuthenticated,
  assertSafeLinkedinUrl,
  normalizeWhitespace,
  unwrapEvaluateResult,
} from './shared.js';

function normalizeProfileUrl(value) {
  const url = assertSafeLinkedinUrl(value || 'https://www.linkedin.com/in/me/', 'profile-url', '/in/me/');
  const parsed = new URL(url);
  if (!/^\/in\/[^/?#]+\/?$/.test(parsed.pathname)) {
    throw new CommandExecutionError('LinkedIn services-read requires a /in/<handle>/ profile URL');
  }
  return parsed.toString();
}

function normalizeServicesUrl(value) {
  const url = assertSafeLinkedinUrl(value, 'services-url', '/services/page/');
  const parsed = new URL(url);
  if (!/^\/services\/page\/[^/?#]+\/?$/.test(parsed.pathname)) {
    throw new CommandExecutionError('LinkedIn services-read requires a /services/page/<id>/ URL');
  }
  return parsed.toString();
}

function buildFindServicesUrlScript() {
  return String.raw`(() => {
    const link = Array.from(document.querySelectorAll('a[href*="/services/page/"]'))
      .map((a) => a.href || '')
      .find(Boolean);
    return { services_url: link || '' };
  })()`;
}

function buildServicesPageScript() {
  return String.raw`(() => {
    const clean = (s) => String(s || '').replace(/[\u00a0\u202f]+/g, ' ').replace(/\s+/g, ' ').trim();
    const lines = (document.body?.innerText || '').split(/\n+/).map(clean).filter(Boolean);
    const unique = (items) => Array.from(new Set(items.filter(Boolean)));
    const collectAfter = (label, stops) => {
      const index = lines.findIndex((line) => line === label);
      if (index < 0) return [];
      const out = [];
      for (let i = index + 1; i < lines.length; i++) {
        if (stops.includes(lines[i])) break;
        if (lines[i] !== label) out.push(lines[i]);
      }
      return unique(out);
    };
    return {
      service_url: location.href,
      page_title: clean(document.querySelector('main h1, h1')?.innerText || document.title || ''),
      overview: collectAfter('Overview', ['Availability', 'Pricing', 'Services provided', 'Media', 'Reviews']).join('\n'),
      availability: collectAfter('Availability', ['Pricing', 'Services provided', 'Media', 'Reviews']).join('; '),
      pricing: collectAfter('Pricing', ['Services provided', 'Media', 'Reviews']).join('; '),
      services_provided: collectAfter('Services provided', ['Media', 'Reviews', 'Pricing', 'Availability', 'Overview']),
    };
  })()`;
}

function buildMediaPageScript() {
  return String.raw`(() => {
    const clean = (s) => String(s || '').replace(/[\u00a0\u202f]+/g, ' ').replace(/\s+/g, ' ').trim();
    const lines = (document.body?.innerText || '').split(/\n+/).map(clean).filter(Boolean);
    const start = lines.findIndex((line) => line === 'Add media');
    const end = lines.findIndex((line, index) => index > start && line === 'Done');
    const media_lines = start >= 0 && end > start ? lines.slice(start + 1, end) : [];
    return { media_lines };
  })()`;
}

function buildServicesEditScript() {
  return String.raw`(() => {
    const clean = (s) => String(s || '').replace(/[\u00a0\u202f]+/g, ' ').replace(/\s+/g, ' ').trim();
    const dialog = document.querySelector('dialog') || document;
    const overview = dialog.querySelector('textarea')?.value || '';
    const checked = Array.from(dialog.querySelectorAll('[role="checkbox"], [role="switch"], input[type="checkbox"]'))
      .map((el) => ({
        label: clean(el.getAttribute('aria-label') || el.innerText || el.closest('div')?.innerText || el.parentElement?.innerText || ''),
        checked: el.getAttribute('aria-checked') === 'true' || el.checked === true,
      }));
    const radios = Array.from(dialog.querySelectorAll('[role="radio"], input[type="radio"]'))
      .map((el) => ({
        label: clean(el.getAttribute('aria-label') || el.innerText || el.closest('div')?.innerText || el.parentElement?.innerText || ''),
        checked: el.getAttribute('aria-checked') === 'true' || el.checked === true,
      }));
    return {
      overview,
      work_locations: checked.filter((item) => item.checked && !/message|linkedin members|reviews?/i.test(item.label)).map((item) => item.label),
      messages: checked.find((item) => /message|open profile/i.test(item.label))?.checked ? 'on' : 'off',
      reviews_visibility: checked.find((item) => /all linkedin members/i.test(item.label))?.checked ? 'on' : 'off',
      pricing: radios.find((item) => item.checked)?.label || '',
    };
  })()`;
}

function pairsToMedia(items) {
  const lines = Array.isArray(items) ? items.map(normalizeWhitespace).filter(Boolean) : [];
  const pairs = [];
  for (let i = 0; i < lines.length; i += 2) {
    const title = lines[i] || '';
    const description = lines[i + 1] || '';
    if (title) pairs.push(description ? `${title} — ${description}` : title);
  }
  return pairs;
}

function normalizeServices(row) {
  if (!row || typeof row !== 'object') {
    throw new CommandExecutionError('LinkedIn services-read returned malformed extraction payload');
  }
  const services = Array.isArray(row.services_provided) ? row.services_provided.map(normalizeWhitespace).filter(Boolean) : [];
  const mediaItems = pairsToMedia(row.media_lines);
  const publicMedia = [];
  const serviceUrl = normalizeWhitespace(row.service_url);
  const pageTitle = normalizeWhitespace(row.page_title);
  const overview = normalizeWhitespace(row.overview);
  const availability = normalizeWhitespace(row.availability);
  if (!serviceUrl || (!pageTitle && !overview && services.length === 0)) {
    throw new CommandExecutionError('LinkedIn services-read could not find stable Services page content');
  }
  return {
    service_url: serviceUrl,
    page_title: pageTitle,
    overview,
    availability,
    work_locations: Array.isArray(row.work_locations) ? row.work_locations.map((item) => {
      const text = normalizeWhitespace(item);
      const words = text.split(' ');
      if (words.length % 2 === 0) {
        const half = words.length / 2;
        const left = words.slice(0, half).join(' ');
        if (left === words.slice(half).join(' ')) return left;
      }
      return text;
    }).filter(Boolean).join('; ') : '',
    pricing: normalizeWhitespace(row.pricing).replace(/^Pricing,\s*Select one option,\s*/i, '').replace(/,\s*required$/i, ''),
    services_provided: services.join('; '),
    services_count: String(services.length),
    media: (mediaItems.length > 0 ? mediaItems : publicMedia).join('\n'),
    media_count: String(mediaItems.length || publicMedia.length),
    messages: normalizeWhitespace(row.messages),
    reviews_visibility: normalizeWhitespace(row.reviews_visibility),
  };
}

async function readOwnerOnlyServicesEdit(page, servicesUrl) {
  const editUrl = new URL(servicesUrl);
  editUrl.pathname = editUrl.pathname.replace(/\/?$/, '/edit/');
  await page.goto(editUrl.toString());
  await page.wait(4);
  await assertLinkedInAuthenticated(page, 'LinkedIn services-read edit');
  return unwrapEvaluateResult(await page.evaluate(buildServicesEditScript()));
}

cli({
  site: 'linkedin',
  name: 'services-read',
  access: 'read',
  description: 'Read LinkedIn Services page details including services, overview, availability, pricing, and media titles/descriptions',
  domain: 'www.linkedin.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'profile-url', type: 'string', required: false, help: 'LinkedIn /in/<handle>/ profile URL. Defaults to /in/me/.' },
    { name: 'services-url', type: 'string', required: false, help: 'LinkedIn /services/page/<id>/ URL. If omitted, it is discovered from the profile.' },
  ],
  columns: ['service_url', 'page_title', 'overview', 'availability', 'work_locations', 'pricing', 'services_provided', 'services_count', 'media', 'media_count', 'messages', 'reviews_visibility'],
  func: async (page, args) => {
    if (!page) throw new CommandExecutionError('Browser session required for linkedin services-read');
    let servicesUrl = normalizeWhitespace(args['services-url']);
    const shouldReadOwnerEdit = !servicesUrl && !normalizeWhitespace(args['profile-url']);
    if (servicesUrl) {
      servicesUrl = normalizeServicesUrl(servicesUrl);
    } else {
      await page.goto(normalizeProfileUrl(args['profile-url']));
      await page.wait(5);
      await assertLinkedInAuthenticated(page, 'LinkedIn services-read profile');
      const found = unwrapEvaluateResult(await page.evaluate(buildFindServicesUrlScript()));
      servicesUrl = normalizeWhitespace(found?.services_url);
      if (!servicesUrl) throw new EmptyResultError('linkedin services-read', 'No LinkedIn Services page link was found on the profile.');
      servicesUrl = normalizeServicesUrl(servicesUrl);
    }

    await page.goto(servicesUrl);
    await page.wait(5);
    await assertLinkedInAuthenticated(page, 'LinkedIn services-read');
    const services = unwrapEvaluateResult(await page.evaluate(buildServicesPageScript()));

    const edit = shouldReadOwnerEdit ? await readOwnerOnlyServicesEdit(page, servicesUrl) : {};

    let media = {};
    if (shouldReadOwnerEdit) {
      const mediaUrl = new URL(servicesUrl);
      mediaUrl.pathname = mediaUrl.pathname.replace(/\/?$/, '/media/');
      await page.goto(mediaUrl.toString());
      await page.wait(4);
      await assertLinkedInAuthenticated(page, 'LinkedIn services-read media');
      media = unwrapEvaluateResult(await page.evaluate(buildMediaPageScript()));
    }

    return [normalizeServices({ ...services, ...edit, ...media })];
  },
});

export const __test__ = {
  normalizeProfileUrl,
  normalizeServicesUrl,
  pairsToMedia,
  normalizeServices,
};
