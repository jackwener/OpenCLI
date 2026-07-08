import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import {
  assertLinkedInAuthenticated,
  assertSafeLinkedinUrl,
  normalizeHttpUrl,
  normalizeWhitespace,
  unwrapEvaluateResult,
} from './shared.js';

const DATE_RANGE_RE = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{4}\s*[–-]\s*(?:present|[a-z]{3,9}\s+\d{4})\b/i;
const YEAR_RANGE_RE = /\b\d{4}\s*[–-]\s*(?:present|\d{4})\b/i;

function normalizeProfileUrl(value) {
  const url = assertSafeLinkedinUrl(value || 'https://www.linkedin.com/in/me/', 'profile-url', '/in/me/');
  const parsed = new URL(url);
  if (!/^\/in\/[^/?#]+\/?$/.test(parsed.pathname)) {
    throw new CommandExecutionError('LinkedIn profile-experience requires a /in/<handle>/ profile URL');
  }
  return parsed.toString();
}

function profileExperienceUrl(profileUrl) {
  const url = assertSafeLinkedinUrl(profileUrl, 'profile-url');
  const parsed = new URL(url);
  if (!/^\/in\/[^/?#]+\/?$/.test(parsed.pathname) || parsed.pathname === '/in/me/') {
    throw new CommandExecutionError('LinkedIn profile-experience requires a resolved /in/<handle>/ profile URL');
  }
  return new URL(`${parsed.pathname.replace(/\/?$/, '/') }details/experience/`, 'https://www.linkedin.com').toString();
}

function decodeLinkedInSafetyUrl(value) {
  const url = normalizeWhitespace(value);
  if (!url) return '';
  try {
    const parsed = new URL(url);
    if (parsed.hostname.endsWith('linkedin.com') && parsed.pathname === '/safety/go/') {
      return normalizeHttpUrl(parsed.searchParams.get('url') || '');
    }
  } catch {}
  return normalizeHttpUrl(url);
}

function isChromeLine(line) {
  return /^(show all|show less|edit|delete|add experience|back to profile|experience|show credential|show media|see more|see less|←|\+)$/i.test(line);
}

function isDateLine(line) {
  return DATE_RANGE_RE.test(line) || YEAR_RANGE_RE.test(line);
}

function splitLinkedInDotLine(line) {
  return normalizeWhitespace(line).split(/\s*[·•]\s*/).map(normalizeWhitespace).filter(Boolean);
}

function parseDateRangeParts(dateLine) {
  const primary = splitLinkedInDotLine(dateLine)[0] || normalizeWhitespace(dateLine);
  const match = primary.match(DATE_RANGE_RE) || primary.match(YEAR_RANGE_RE);
  const dateRange = match ? normalizeWhitespace(match[0]) : primary;
  const [startDate = '', endDate = ''] = dateRange.split(/\s*[–-]\s*/).map(normalizeWhitespace);
  return { dateRange, startDate, endDate };
}

function parseCompanyLine(companyLine) {
  const parts = splitLinkedInDotLine(companyLine);
  return {
    company: parts[0] || normalizeWhitespace(companyLine),
    employment_type: parts.slice(1).join(' · '),
  };
}

function parseLocationLine(locationLine) {
  const parts = splitLinkedInDotLine(locationLine);
  return {
    location: parts[0] || normalizeWhitespace(locationLine),
    location_type: parts.slice(1).join(' · '),
  };
}

function parseExperienceText(rawText, profileUrl, index, totalCount = 0) {
  const lines = String(rawText || '')
    .split(/\n+/)
    .map(normalizeWhitespace)
    .filter(Boolean)
    .filter((line) => !isChromeLine(line));
  const title = lines[0] || '';
  const dateIndex = lines.findIndex(isDateLine);
  const companyLine = dateIndex > 1 ? lines[1] : (lines[1] || '');
  const { company, employment_type: parsedEmploymentType } = parseCompanyLine(companyLine);
  const dateParts = dateIndex >= 0 ? parseDateRangeParts(lines[dateIndex]) : { dateRange: '', startDate: '', endDate: '' };
  const locationLine = dateIndex >= 0 && lines[dateIndex + 1] && !/^skills?:/i.test(lines[dateIndex + 1])
    ? lines[dateIndex + 1]
    : '';
  const { location, location_type: parsedLocationType } = parseLocationLine(locationLine);
  const skillLine = lines.find((line) => /\bskills?:/i.test(line)) || '';
  const description = lines
    .filter((line, lineIndex) => lineIndex !== 0)
    .filter((line) => line !== companyLine && line !== lines[dateIndex] && line !== locationLine && line !== skillLine)
    .join(' ');
  return {
    rank: index + 1,
    total_count: totalCount,
    title,
    employment_type: parsedEmploymentType,
    company,
    date_range: dateParts.dateRange,
    start_date: dateParts.startDate,
    end_date: dateParts.endDate,
    location,
    location_type: parsedLocationType,
    description,
    skills: skillLine.replace(/^skills?:\s*/i, ''),
    media: '',
    urls: '',
    profile_url: profileUrl,
    raw_text: lines.join(' | '),
  };
}

function parseExperienceSectionText(rawText, profileUrl) {
  const stopLine = (line) => /^(who your viewers also viewed|people you may know|about|accessibility|talent solutions|community guidelines|careers|marketing solutions|privacy & terms)$/i.test(line);
  const lines = String(rawText || '')
    .split(/\n+/)
    .map(normalizeWhitespace)
    .filter(Boolean)
    .filter((line) => !isChromeLine(line));
  const scoped = [];
  for (const line of lines) {
    if (stopLine(line)) break;
    scoped.push(line);
  }
  const rows = [];
  for (let i = 0; i < scoped.length - 2; i++) {
    if (!isDateLine(scoped[i + 2]) && !isDateLine(scoped[i + 1])) continue;
    const dateOffset = isDateLine(scoped[i + 1]) ? 1 : 2;
    let end = scoped.length;
    for (let j = i + dateOffset + 1; j < scoped.length - 2; j++) {
      if (isDateLine(scoped[j + 2]) || isDateLine(scoped[j + 1])) {
        end = j;
        break;
      }
    }
    const row = parseExperienceText(scoped.slice(i, end).join('\n'), profileUrl, rows.length);
    if (row.title && row.company) rows.push(row);
    i = end - 1;
  }
  return rows.map((row) => ({ ...row, total_count: rows.length }));
}

function buildExperienceExtractionScript() {
  return String.raw`(() => {
    const clean = (s) => String(s || '').replace(/[\u00a0\u202f]+/g, ' ').replace(/\s+/g, ' ').trim();
    const DATE_RANGE_RE = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{4}\s*[–-]\s*(?:present|[a-z]{3,9}\s+\d{4})\b/i;
    const YEAR_RANGE_RE = /\b\d{4}\s*[–-]\s*(?:present|\d{4})\b/i;
    const isDateLine = (line) => DATE_RANGE_RE.test(line) || YEAR_RANGE_RE.test(line);
    const isChromeLine = (line) => /^(show all|show less|edit|delete|add experience|back to profile|experience|show credential|show media|see more|see less|←|\+)$/i.test(line);
    const splitLines = (text) => String(text || '').split(/\n+/).map(clean).filter(Boolean);
    const splitDotLine = (line) => clean(line).split(/\s*[·•]\s*/).map(clean).filter(Boolean);
    const looksLocationLine = (line) => /remote|hybrid|on-site|india|area|bengaluru|jaipur|delhi|mumbai|pune|gurugram|noida|hyderabad|chennai|kolkata/i.test(line || '');
    const decodeLinkedInSafetyUrl = (value) => {
      if (!value) return '';
      try {
        const parsed = new URL(value, location.origin);
        if (parsed.hostname.endsWith('linkedin.com') && parsed.pathname === '/safety/go/') {
          const decoded = parsed.searchParams.get('url') || '';
          try {
            const target = new URL(decoded, location.origin);
            if (target.protocol === 'http:' || target.protocol === 'https:') return target.toString();
            return '';
          } catch {
            return '';
          }
        }
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.toString();
        return '';
      } catch {
        return '';
      }
    };
    const parseDateParts = (dateLine) => {
      const primary = splitDotLine(dateLine)[0] || clean(dateLine);
      const match = primary.match(DATE_RANGE_RE) || primary.match(YEAR_RANGE_RE);
      const dateRange = match ? clean(match[0]) : primary;
      const parts = dateRange.split(/\s*[–-]\s*/).map(clean);
      return { dateRange, startDate: parts[0] || '', endDate: parts[1] || '' };
    };
    const parseRow = (root, index, totalCount, context = {}) => {
      const raw = clean(root.innerText || root.textContent || '');
      const lines = splitLines(root.innerText || root.textContent || '').filter((line) => !isChromeLine(line));
      const ariaMatch = clean(context.ariaLabel || '').match(/^edit\s+(.+?)\s+at\s+(.+)$/i);
      const title = lines[0] || ariaMatch?.[1] || '';
      const dateIndex = lines.findIndex(isDateLine);
      const companyLine = dateIndex > 1 ? lines[1] : (lines[1] || '');
      const companyParts = splitDotLine(companyLine);
      const groupEmploymentParts = splitDotLine(context.employment_type || '');
      const company = (dateIndex > 1 ? companyParts[0] : '') || context.company || ariaMatch?.[2] || companyParts[0] || companyLine;
      const parsedEmploymentType = dateIndex > 1
        ? companyParts.slice(1).join(' · ')
        : (groupEmploymentParts[0] || context.employment_type || '');
      const dateParts = dateIndex >= 0 ? parseDateParts(lines[dateIndex]) : { dateRange: '', startDate: '', endDate: '' };
      const lineAfterDate = dateIndex >= 0 ? lines[dateIndex + 1] : '';
      const locationLine = lineAfterDate && looksLocationLine(lineAfterDate) && !/^skills?:/i.test(lineAfterDate)
        ? lines[dateIndex + 1]
        : (context.location || '');
      const locationParts = splitDotLine(locationLine || context.location || '');
      const skillLine = lines.find((line) => /\bskills?:|(?:\+[\d,]+\s+skills?\b)|(?:\band\s+\+[\d,]+\s+skills?\b)/i.test(line)) || '';
      const skillUrl = Array.from(root.querySelectorAll('a[href*="/skill-associations-details/"]'))
        .map((link) => new URL(link.href, location.origin).toString())
        .find(Boolean) || '';
      const media = Array.from(root.querySelectorAll('img[alt], video'))
        .map((node) => node.tagName.toLowerCase() === 'video' ? 'video' : clean(node.getAttribute('alt') || ''))
        .filter(Boolean)
        .filter((value) => !/profile|photo of|emoji|reaction|company logo|\blogo$/i.test(value));
      const mediaTitleLines = Array.from(root.querySelectorAll('a[href*="/overlay/Position/"] p, a[href*="/treasury/"] p'))
        .map((node) => clean(node.textContent || ''))
        .filter(Boolean);
      const mediaBodyLines = Array.from(root.querySelectorAll('a[href*="/overlay/Position/"] span, a[href*="/treasury/"] span'))
        .map((node) => clean(node.textContent || ''))
        .filter(Boolean);
      const firstMediaLineIndex = lines.findIndex((line) => mediaTitleLines.includes(line));
      const description = lines
        .filter((line, lineIndex) => lineIndex !== 0)
        .filter((line, lineIndex) => firstMediaLineIndex < 0 || lineIndex < firstMediaLineIndex)
        .filter((line) => line !== companyLine && line !== lines[dateIndex] && line !== locationLine && line !== skillLine)
        .filter((line) => !mediaTitleLines.includes(line))
        .filter((line) => !mediaBodyLines.includes(line))
        .filter((line) => !/^thumbnail for\b/i.test(line))
        .join(' ');
      const urls = Array.from(root.querySelectorAll('a[href]'))
        .map((link) => new URL(link.href, location.origin).toString())
        .filter((href) => {
          try {
            const parsed = new URL(href);
            const path = parsed.pathname;
            if (/\/details\/experience\/edit\/forms\//i.test(path)) return false;
            if (/\/skill-associations-details\//i.test(path)) return false;
            if (/\/overlay\/Position\/|\/treasury\//i.test(path)) return true;
            if (/\/in\//i.test(path) || /\/search\//i.test(path) || /\/company\//i.test(path)) return false;
            return true;
          } catch {
            return false;
          }
        })
        .map(decodeLinkedInSafetyUrl)
        .map((href) => /linkedin\.com/i.test(href) ? href.replace(/[?#].*$/, '') : href);
      return {
        rank: index + 1,
        total_count: totalCount,
        title,
        employment_type: parsedEmploymentType,
        company,
        date_range: dateParts.dateRange,
        start_date: dateParts.startDate,
        end_date: dateParts.endDate,
        location: locationParts[0] || locationLine,
        location_type: locationParts.slice(1).join(' · '),
        description,
        skills: skillLine.replace(/^skills?:\s*/i, ''),
        media: Array.from(new Set(media)).join(' | '),
        urls: Array.from(new Set(urls)).join(' | '),
        skill_url: skillUrl,
        media_url: urls.find((href) => /\/overlay\/Position\/|\/treasury\//i.test(href)) || '',
        profile_url: location.href.replace(/\/details\/experience\/?.*$/i, '/'),
        raw_text: raw,
      };
    };
    const main = document.querySelector('main') || document.body;
    const findSmallestExperienceRoot = (link) => {
      const ownFormPath = new URL(link.href, location.origin).pathname;
      let node = link.parentElement;
      let best = link;
      while (node && node !== main && node !== document.body) {
        const text = clean(node.innerText || node.textContent || '');
        const uniqueFormPaths = Array.from(new Set(Array.from(node.querySelectorAll('a[href*="/details/experience/edit/forms/"]'))
          .map((formLink) => new URL(formLink.href, location.origin).pathname)));
        if (uniqueFormPaths.length > 1) break;
        if (uniqueFormPaths.includes(ownFormPath) && isDateLine(text) && text.length < 2500) best = node;
        node = node.parentElement;
      }
      return best || link;
    };
    const findGroupContext = (root) => {
      let group = root.parentElement;
      while (group && group !== main && group !== document.body && !group.querySelector('ul')) {
        group = group.parentElement;
      }
      if (!group || group === main || group === document.body) return {};
      const listText = clean(root.innerText || root.textContent || '');
      const groupLines = splitLines(group.innerText || group.textContent || '')
        .filter((line) => !isChromeLine(line));
      const companyLink = Array.from(group.querySelectorAll('a[href*="/company/"] p'))
        .map((node) => clean(node.textContent || ''))
        .find(Boolean);
      const groupCompany = companyLink || groupLines.find((line) => !isDateLine(line) && !listText.includes(line) && !/full-time|part-time|contract|freelance|self-employed/i.test(line)) || '';
      const groupEmployment = groupLines.find((line) => /full-time|part-time|contract|freelance|self-employed|internship/i.test(line)) || '';
      const groupLocation = groupLines.find((line) => /remote|hybrid|on-site|india|area|bengaluru|jaipur/i.test(line) && !isDateLine(line) && line !== groupEmployment && !listText.includes(line)) || '';
      return {
        company: groupCompany,
        employment_type: groupEmployment,
        location: groupLocation,
      };
    };
    const formLinks = Array.from(main.querySelectorAll('a[href*="/details/experience/edit/forms/"]'));
    const linksByForm = new Map();
    for (const link of formLinks) {
      const href = new URL(link.href, location.origin).pathname;
      const current = linksByForm.get(href) || {};
      const ariaLabel = clean(link.getAttribute('aria-label') || current.ariaLabel || '');
      const text = clean(link.innerText || link.textContent || current.text || '');
      linksByForm.set(href, { link: current.link || link, ariaLabel, text });
    }
    const candidates = Array.from(linksByForm.values())
      .map(({ link, ariaLabel }) => {
        const root = findSmallestExperienceRoot(link);
        return { root, ariaLabel, context: findGroupContext(root) };
      })
      .filter(({ root }) => {
        const text = clean(root.innerText || root.textContent || '');
        if (text.length < 12) return false;
        if (/^(experience|show all|show less|edit|add experience)$/i.test(text)) return false;
        return isDateLine(text) && !/\bfeatured\b/i.test(text);
      });
    const experienceRows = [];
    const seen = new Set();
    for (const candidate of candidates) {
      const row = parseRow(candidate.root, experienceRows.length, 0, { ...candidate.context, ariaLabel: candidate.ariaLabel });
      const key = row.title + '::' + row.company + '::' + row.date_range + '::' + row.description.slice(0, 80);
      if (!row.title || !row.company || seen.has(key)) continue;
      seen.add(key);
      experienceRows.push(row);
    }
    if (experienceRows.length === 0) {
      const section = Array.from(main.querySelectorAll('section'))
        .find((node) => /^Experience\b/i.test(clean(node.innerText || node.textContent || '')));
      const sectionLines = splitLines(section?.innerText || section?.textContent || '').filter((line) => !isChromeLine(line));
      const scopedLines = [];
      for (const line of sectionLines) {
        if (/^(who your viewers also viewed|people you may know|about|accessibility|talent solutions|community guidelines|careers|marketing solutions|privacy & terms)$/i.test(line)) break;
        scopedLines.push(line);
      }
      for (let i = 0; i < scopedLines.length - 2; i++) {
        if (!isDateLine(scopedLines[i + 2]) && !isDateLine(scopedLines[i + 1])) continue;
        const dateOffset = isDateLine(scopedLines[i + 1]) ? 1 : 2;
        let end = scopedLines.length;
        for (let j = i + dateOffset + 1; j < scopedLines.length - 2; j++) {
          if (isDateLine(scopedLines[j + 2]) || isDateLine(scopedLines[j + 1])) {
            end = j;
            break;
          }
        }
        const syntheticRoot = {
          innerText: scopedLines.slice(i, end).join('\n'),
          textContent: scopedLines.slice(i, end).join('\n'),
          querySelectorAll: () => [],
        };
        const row = parseRow(syntheticRoot, experienceRows.length, 0);
        const key = row.title + '::' + row.company + '::' + row.date_range + '::' + row.description.slice(0, 80);
        if (row.title && row.company && !seen.has(key)) {
          seen.add(key);
          experienceRows.push(row);
        }
        i = end - 1;
      }
    }
    return {
      experienceRows: experienceRows.map((row, index) => ({ ...row, rank: index + 1, total_count: experienceRows.length })),
      pageHref: location.href,
      pageTitle: document.title || '',
    };
  })()`;
}

function normalizeExperience(row) {
  if (!row || typeof row !== 'object') {
    throw new CommandExecutionError('LinkedIn profile-experience returned malformed row');
  }
  const title = normalizeWhitespace(row.title);
  if (!title) throw new CommandExecutionError('LinkedIn profile-experience returned an experience without a title');
  return {
    rank: Number(row.rank) || 0,
    total_count: Number(row.total_count) || 0,
    title,
    employment_type: normalizeWhitespace(row.employment_type),
    company: normalizeWhitespace(row.company),
    date_range: normalizeWhitespace(row.date_range),
    start_date: normalizeWhitespace(row.start_date),
    end_date: normalizeWhitespace(row.end_date),
    location: normalizeWhitespace(row.location),
    location_type: normalizeWhitespace(row.location_type),
    description: normalizeWhitespace(row.description),
    skills: normalizeWhitespace(row.skills),
    media: normalizeWhitespace(row.media),
    urls: normalizeWhitespace(row.urls),
    skill_url: normalizeWhitespace(row.skill_url),
    media_url: normalizeWhitespace(row.media_url),
    profile_url: normalizeWhitespace(row.profile_url),
    raw_text: normalizeWhitespace(row.raw_text),
  };
}

function buildDialogExtractionScript() {
  return String.raw`(() => {
    const clean = (s) => String(s || '').replace(/[\u00a0\u202f]+/g, ' ').replace(/\s+/g, ' ').trim();
    const decodeLinkedInSafetyUrl = (value) => {
      if (!value) return '';
      try {
        const parsed = new URL(value, location.origin);
        if (parsed.hostname.endsWith('linkedin.com') && parsed.pathname === '/safety/go/') {
          const decoded = parsed.searchParams.get('url') || '';
          try {
            const target = new URL(decoded, location.origin);
            if (target.protocol === 'http:' || target.protocol === 'https:') return target.toString();
            return '';
          } catch {
            return '';
          }
        }
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.toString();
        return '';
      } catch {
        return '';
      }
    };
    const dialog = document.querySelector('dialog[open], dialog[data-testid="dialog"]') || document.querySelector('[role="dialog"]');
    if (!dialog) return { title: '', skills: [], media: [], urls: [] };
    const title = clean(dialog.querySelector('h1,h2,h3,[id="dialog-header"]')?.textContent || '');
    const text = clean(dialog.innerText || dialog.textContent || '');
    const skills = Array.from(dialog.querySelectorAll('a[href*="PROFILE_PAGE_SKILL_NAVIGATION"] p, a[href*="PROFILE_PAGE_SKILL_NAVIGATION"] span, button[aria-label^="Expand "]'))
      .map((node) => {
        const aria = clean(node.getAttribute?.('aria-label') || '');
        if (/^expand\s+/i.test(aria)) return aria.replace(/^expand\s+/i, '');
        return clean(node.textContent || '');
      })
      .filter(Boolean)
      .filter((value) => !/^learn more about/i.test(value));
    const media = Array.from(dialog.querySelectorAll('a[href], [role="link"], li, article'))
      .map((node) => {
        const nodeText = clean(node.innerText || node.textContent || '');
        if (!nodeText || nodeText.length > 800) return null;
        const href = node.matches?.('a[href]') ? decodeLinkedInSafetyUrl(node.href) : '';
        const image = node.querySelector?.('img[alt]')?.getAttribute('alt') || '';
        return { label: nodeText, url: href, image: clean(image) };
      })
      .filter(Boolean);
    const urls = Array.from(dialog.querySelectorAll('a[href]'))
      .map((link) => decodeLinkedInSafetyUrl(link.href))
      .filter(Boolean)
      .filter((href) => !/linkedin\.com\/search\/results\/all/i.test(href));
    const mediaViewUrl = urls.find((href) => !/linkedin\.com/i.test(href)) || '';
    const mediaImage = dialog.querySelector('img[src]')?.getAttribute('src') || '';
    const mediaLines = String(dialog.innerText || dialog.textContent || '')
      .split(/\n+/)
      .map(clean)
      .filter(Boolean)
      .filter((line) => !/^(media|view|previous|next)$/i.test(line));
    const primaryMedia = /^media$/i.test(title) && mediaLines.length
      ? [{ label: mediaLines.join(' - '), url: mediaViewUrl, image: mediaImage }]
      : media;
    return {
      title,
      skills: Array.from(new Set(skills)),
      media: primaryMedia,
      urls: Array.from(new Set(urls)),
    };
  })()`;
}

async function clickOverlayAndExtract(page, url, nth = undefined) {
  const normalizedUrl = normalizeWhitespace(url);
  if (!normalizedUrl) return null;
  const overlayId = normalizedUrl.match(/\/overlay\/(?:Position\/)?(\d+)\//i)?.[1] || '';
  if (!overlayId) return null;
  const isSkillOverlay = /skill-associations-details/i.test(normalizedUrl);
  const selector = isSkillOverlay
    ? `a[href*="/overlay/${overlayId}/skill-associations-details/"]`
    : `a[href*="/overlay/Position/${overlayId}/treasury/"], a[href*="/treasury/"][href*="${overlayId}"]`;
  const closeDialog = async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const hasDialog = unwrapEvaluateResult(await page.evaluate('Boolean(document.querySelector("dialog[data-testid=\\"dialog\\"], [role=\\"dialog\\"]"))'));
      if (!hasDialog) return;
      try {
        await page.click('dialog button[aria-label="Dismiss"], [role="dialog"] button[aria-label="Dismiss"]');
      } catch {
        await page.evaluate('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))');
      }
      await page.wait(1);
    }
  };
  await closeDialog();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await page.click(selector, isSkillOverlay
        ? {}
        : { nth: 0 });
    } catch {
      return null;
    }
    try {
      await page.wait({ selector: 'dialog[data-testid="dialog"], [role="dialog"]', timeout: 10000 });
    } catch {}
    if (isSkillOverlay) {
      try {
        await page.wait({ selector: 'dialog button[aria-label^="Expand "], [role="dialog"] button[aria-label^="Expand "]', timeout: 10000 });
      } catch {}
    } else {
      await page.wait(2);
      for (let index = 0; index < Number(nth || 0); index += 1) {
        await page.evaluate(String.raw`(() => {
          const dialog = document.querySelector('dialog[data-testid="dialog"], [role="dialog"]');
          const button = Array.from(dialog?.querySelectorAll('button') || [])
            .find((candidate) => /^\s*next\s*$/i.test(candidate.innerText || candidate.textContent || ''));
          if (button) button.click();
          return Boolean(button);
        })()`);
        await page.wait(1);
      }
    }
    let payload = unwrapEvaluateResult(await page.evaluate(buildDialogExtractionScript()));
    if (isSkillOverlay && (!payload?.skills || payload.skills.length === 0)) {
      await page.wait(3);
      payload = unwrapEvaluateResult(await page.evaluate(buildDialogExtractionScript()));
    }
    await closeDialog();
    if (payload && typeof payload === 'object') {
      if (!isSkillOverlay || payload.skills?.length) return payload;
    }
  }
  return null;
}

function serializeMediaDetails(details) {
  if (!details || !Array.isArray(details.media)) return '';
  const rows = details.media
    .map((item) => {
      const text = normalizeWhitespace(item?.label);
      const url = normalizeWhitespace(item?.url);
      if (!text && !url) return '';
      return url ? `${text} <${url}>` : text;
    })
    .filter(Boolean);
  return Array.from(new Set(rows)).join(' | ');
}

function splitPipeValues(value) {
  return normalizeWhitespace(value).split('|').map(normalizeWhitespace).filter(Boolean);
}

async function enrichExperienceRows(page, rows) {
  const enriched = [];
  for (const row of rows) {
    let nextRow = { ...row };
    const skillDetails = await clickOverlayAndExtract(page, nextRow.skill_url);
    if (skillDetails?.skills?.length) {
      nextRow.skills = skillDetails.skills.join(', ');
    }
    const mediaCount = splitPipeValues(nextRow.media).length;
    const mediaDetailRows = [];
    const mediaUrls = [];
    for (let mediaIndex = 0; mediaIndex < mediaCount; mediaIndex += 1) {
      const mediaDetails = await clickOverlayAndExtract(page, nextRow.media_url, mediaIndex);
      if (!mediaDetails) continue;
      const mediaText = serializeMediaDetails(mediaDetails);
      if (mediaText) nextRow.media = mediaText;
      if (Array.isArray(mediaDetails.urls) && mediaDetails.urls.length) {
        mediaUrls.push(...mediaDetails.urls.map(normalizeWhitespace).filter(Boolean));
      }
      if (mediaText) mediaDetailRows.push(mediaText);
    }
    if (mediaDetailRows.length) {
      nextRow.media = Array.from(new Set(mediaDetailRows)).join(' | ');
    }
    if (mediaUrls.length) {
      const combinedUrls = [
        ...splitPipeValues(nextRow.urls),
        ...mediaUrls,
      ];
      nextRow.urls = Array.from(new Set(combinedUrls)).join(' | ');
      nextRow.media_url = Array.from(new Set(mediaUrls.filter((href) => !/linkedin\.com/i.test(href)))).join(' | ') || nextRow.media_url;
    }
    enriched.push(nextRow);
  }
  return enriched;
}

cli({
  site: 'linkedin',
  name: 'profile-experience',
  access: 'read',
  description: 'Read visible LinkedIn profile experience entries with titles, dates, locations, skills, media, and URLs',
  domain: 'www.linkedin.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'profile-url', type: 'string', required: false, help: 'LinkedIn /in/<handle>/ profile URL. Defaults to /in/me/.' },
  ],
  columns: [
    'rank',
    'total_count',
    'title',
    'employment_type',
    'company',
    'date_range',
    'start_date',
    'end_date',
    'location',
    'location_type',
    'description',
    'skills',
    'media',
    'urls',
    'skill_url',
    'media_url',
    'profile_url',
    'raw_text',
  ],
  func: async (page, args) => {
    if (!page) throw new CommandExecutionError('Browser session required for linkedin profile-experience');
    const profileUrl = normalizeProfileUrl(args['profile-url']);
    let experienceUrl;
    if (!args['profile-url'] || new URL(profileUrl).pathname === '/in/me/') {
      await page.goto(profileUrl);
      await page.wait(4);
      await assertLinkedInAuthenticated(page, 'LinkedIn profile-experience');
      const resolvedProfileUrl = unwrapEvaluateResult(await page.evaluate(String.raw`(() => {
        const current = new URL(location.href);
        if (/^\/in\/[^/?#]+\/?$/.test(current.pathname) && current.pathname !== '/in/me/') return current.toString();
        const ownProfileLink = Array.from(document.querySelectorAll('a[href^="/in/"]'))
          .map((link) => new URL(link.href, location.origin))
          .find((url) => /^\/in\/[^/?#]+\/?$/.test(url.pathname) && url.pathname !== '/in/me/');
        return ownProfileLink ? ownProfileLink.toString() : '';
      })()`));
      if (!resolvedProfileUrl) {
        throw new CommandExecutionError('LinkedIn profile-experience could not resolve /in/me/ to a profile URL');
      }
      experienceUrl = profileExperienceUrl(resolvedProfileUrl);
    } else {
      experienceUrl = profileExperienceUrl(profileUrl);
    }
    await page.goto(experienceUrl);
    await page.wait(5);
    await assertLinkedInAuthenticated(page, 'LinkedIn profile-experience');
    try {
      await page.wait({ text: 'Experience', timeout: 10000 });
    } catch {}
    await page.autoScroll({ times: 4, delayMs: 700 });
    await page.wait(1);
    const payload = unwrapEvaluateResult(await page.evaluate(buildExperienceExtractionScript()));
    if (!payload || !Array.isArray(payload.experienceRows)) {
      throw new CommandExecutionError('LinkedIn profile-experience returned malformed extraction payload');
    }
    const rows = await enrichExperienceRows(page, payload.experienceRows.map(normalizeExperience));
    if (rows.length === 0) {
      throw new EmptyResultError('linkedin profile-experience', 'No visible LinkedIn profile experience entries were found.');
    }
    return rows.map((row, index) => ({ ...row, rank: index + 1, total_count: rows.length }));
  },
});

export const __test__ = {
  normalizeProfileUrl,
  profileExperienceUrl,
  decodeLinkedInSafetyUrl,
  parseDateRangeParts,
  parseCompanyLine,
  parseLocationLine,
  parseExperienceText,
  parseExperienceSectionText,
  buildExperienceExtractionScript,
  buildDialogExtractionScript,
  normalizeExperience,
};
