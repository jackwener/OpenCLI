import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import {
  assertLinkedInAuthenticated,
  assertSafeLinkedinUrl,
  normalizeHttpUrl,
  normalizeWhitespace,
  unwrapEvaluateResult,
} from './shared.js';

function normalizeProfileUrl(value) {
  const url = assertSafeLinkedinUrl(value || 'https://www.linkedin.com/in/me/', 'profile-url', '/in/me/');
  const parsed = new URL(url);
  if (!/^\/in\/[^/?#]+\/?$/.test(parsed.pathname)) {
    throw new CommandExecutionError('LinkedIn profile-projects requires a /in/<handle>/ profile URL');
  }
  return parsed.toString();
}

function profileProjectsUrl(profileUrl) {
  const url = assertSafeLinkedinUrl(profileUrl, 'profile-url');
  const parsed = new URL(url);
  if (!/^\/in\/[^/?#]+\/?$/.test(parsed.pathname) || parsed.pathname === '/in/me/') {
    throw new CommandExecutionError('LinkedIn profile-projects requires a resolved /in/<handle>/ profile URL');
  }
  return new URL(`${parsed.pathname.replace(/\/?$/, '/') }details/projects/`, 'https://www.linkedin.com').toString();
}

function parseProjectText(rawText, profileUrl, index) {
  const lines = String(rawText || '')
    .split(/\n+/)
    .map(normalizeWhitespace)
    .filter(Boolean)
    .filter((line) => !/^(show all|show less|edit|delete|add project|back to profile|projects)$/i.test(line));
  const title = lines[0] || '';
  const dateIndex = lines.findIndex((line) => /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d{4}|present)\b/i.test(line));
  const dateRange = dateIndex >= 0 ? lines[dateIndex] : '';
  const associatedWith = lines.find((line) => /^associated with\b/i.test(line)) || '';
  const skillLine = lines.find((line) => /\bskills?:/i.test(line)) || '';
  const description = lines
    .filter((line, lineIndex) => lineIndex !== 0)
    .filter((line) => line !== dateRange && line !== associatedWith && line !== skillLine)
    .join(' ');
  return {
    rank: index + 1,
    title,
    date_range: dateRange,
    associated_with: associatedWith.replace(/^associated with\s*/i, ''),
    description,
    skills: skillLine.replace(/^skills?:\s*/i, ''),
    media: '',
    urls: '',
    profile_url: profileUrl,
    raw_text: lines.join(' | '),
  };
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

function parseProjectsSectionText(rawText, profileUrl) {
  const isDateLine = (line) => /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{4}\s*[–-]\s*(?:present|[a-z]{3,9}\s+\d{4})\b/i.test(line);
  const stopLine = (line) => /^(who your viewers also viewed|people you may know|about|accessibility|talent solutions|community guidelines|careers|marketing solutions|privacy & terms)$/i.test(line);
  const lines = String(rawText || '')
    .split(/\n+/)
    .map(normalizeWhitespace)
    .filter(Boolean)
    .filter((line) => !/^(show all|show less|edit|delete|add project|back to profile|projects|show project|←|\+)$/i.test(line));
  const scoped = [];
  for (const line of lines) {
    if (stopLine(line)) break;
    scoped.push(line);
  }
  const rows = [];
  for (let i = 0; i < scoped.length - 1; i++) {
    if (!isDateLine(scoped[i + 1])) continue;
    let end = scoped.length;
    for (let j = i + 2; j < scoped.length - 1; j++) {
      if (isDateLine(scoped[j + 1])) {
        end = j;
        break;
      }
    }
    const row = parseProjectText(scoped.slice(i, end).join('\n'), profileUrl, rows.length);
    if (row.title) rows.push(row);
    i = end - 1;
  }
  return rows;
}

function buildProjectsExtractionScript() {
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
    const splitLines = (text) => String(text || '').split(/\n+/).map(clean).filter(Boolean);
    const isChromeLine = (line) => /^(show all|show less|edit|delete|add project|back to profile|projects|show project|←|\+)$/i.test(line);
    const isDateLine = (line) => /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{4}\s*[–-]\s*(?:present|[a-z]{3,9}\s+\d{4})\b/i.test(line);
    const parseRow = (root, index) => {
      const raw = clean(root.innerText || root.textContent || '');
      const lines = splitLines(root.innerText || root.textContent || '')
        .filter((line) => !isChromeLine(line));
      const title = lines[0] || '';
      const dateLine = lines.find((line) => /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d{4}|present)\b/i.test(line)) || '';
      const associatedLine = lines.find((line) => /^associated with\b/i.test(line)) || '';
      const skillLine = lines.find((line) => /\bskills?:/i.test(line)) || '';
      const description = lines
        .filter((line, lineIndex) => lineIndex !== 0)
        .filter((line) => line !== dateLine && line !== associatedLine && line !== skillLine)
        .join(' ');
      const urls = Array.from(root.querySelectorAll('a[href]'))
        .map((link) => new URL(link.href, location.origin).toString())
        .filter((href) => !/linkedin\.com\/in\//i.test(href) && !/linkedin\.com\/search\//i.test(href))
        .map(decodeLinkedInSafetyUrl)
        .filter(Boolean)
        .map((href) => /linkedin\.com/i.test(href) ? href.replace(/[?#].*$/, '') : href);
      const media = Array.from(root.querySelectorAll('img[alt], video'))
        .map((node) => node.tagName.toLowerCase() === 'video' ? 'video' : clean(node.getAttribute('alt') || ''))
        .filter(Boolean)
        .filter((value) => !/profile|photo of|emoji|reaction/i.test(value));
      return {
        rank: index + 1,
        title,
        date_range: dateLine,
        associated_with: associatedLine.replace(/^associated with\s*/i, ''),
        description,
        skills: skillLine.replace(/^skills?:\s*/i, ''),
        media: Array.from(new Set(media)).join(' | '),
        urls: Array.from(new Set(urls)).join(' | '),
        profile_url: location.href.replace(/\/details\/projects\/?.*$/i, '/'),
        raw_text: raw,
      };
    };
    const main = document.querySelector('main') || document.body;
    const projectLinksByTitle = new Map(Array.from(main.querySelectorAll('a[href][aria-label^="Show "]'))
      .map((link) => {
        const label = clean(link.getAttribute('aria-label') || '');
        const title = label.replace(/^Show\s+/i, '').replace(/\s+project$/i, '');
        return [title, decodeLinkedInSafetyUrl(link.href)];
      })
      .filter(([title, href]) => title && href));
    const candidates = Array.from(main.querySelectorAll('li, [role="listitem"], article'))
      .filter((node) => {
        const text = clean(node.innerText || node.textContent || '');
        if (text.length < 8) return false;
        if (/^(projects|show all|show less|edit|add project)$/i.test(text)) return false;
        return /\b(?:associated with|skills?:|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d{4}|present)\b/i.test(text);
      });
    const projectRows = [];
    const seen = new Set();
    for (const candidate of candidates) {
      const row = parseRow(candidate, projectRows.length);
      row.urls = row.urls || projectLinksByTitle.get(row.title) || '';
      const key = row.title + '::' + row.date_range + '::' + row.description.slice(0, 80);
      if (!row.title || seen.has(key)) continue;
      seen.add(key);
      projectRows.push(row);
    }
    if (projectRows.length === 0) {
      const section = Array.from(main.querySelectorAll('section'))
        .find((node) => /^Projects\b/i.test(clean(node.innerText || node.textContent || '')));
      const sectionLines = splitLines(section?.innerText || section?.textContent || '');
      const startIndex = sectionLines.findIndex((line) => /^projects$/i.test(line));
      const scopedLines = [];
      for (const line of sectionLines.slice(startIndex >= 0 ? startIndex + 1 : 0)) {
        if (/^(who your viewers also viewed|people you may know|about|accessibility|talent solutions|community guidelines|careers|marketing solutions|privacy & terms)$/i.test(line)) break;
        if (isChromeLine(line)) continue;
        scopedLines.push(line);
      }
      for (let i = 0; i < scopedLines.length - 1; i++) {
        if (!isDateLine(scopedLines[i + 1])) continue;
        let end = scopedLines.length;
        for (let j = i + 2; j < scopedLines.length - 1; j++) {
          if (isDateLine(scopedLines[j + 1])) {
            end = j;
            break;
          }
        }
        const syntheticRoot = {
          innerText: scopedLines.slice(i, end).join('\n'),
          textContent: scopedLines.slice(i, end).join('\n'),
          querySelectorAll: () => [],
        };
        const row = parseRow(syntheticRoot, projectRows.length);
        row.urls = projectLinksByTitle.get(row.title) || row.urls;
        const key = row.title + '::' + row.date_range + '::' + row.description.slice(0, 80);
        if (row.title && !seen.has(key)) {
          seen.add(key);
          projectRows.push(row);
        }
        i = end - 1;
      }
    }
    return { projectRows, pageHref: location.href, pageTitle: document.title || '' };
  })()`;
}

function normalizeProject(row) {
  if (!row || typeof row !== 'object') {
    throw new CommandExecutionError('LinkedIn profile-projects returned malformed row');
  }
  const title = normalizeWhitespace(row.title);
  if (!title) throw new CommandExecutionError('LinkedIn profile-projects returned a project without a title');
  return {
    rank: Number(row.rank) || 0,
    title,
    date_range: normalizeWhitespace(row.date_range),
    associated_with: normalizeWhitespace(row.associated_with),
    description: normalizeWhitespace(row.description),
    skills: normalizeWhitespace(row.skills),
    media: normalizeWhitespace(row.media),
    urls: normalizeWhitespace(row.urls)
      .split(/\s*\|\s*/)
      .map((url) => normalizeHttpUrl(url))
      .filter(Boolean)
      .join(' | '),
    profile_url: normalizeWhitespace(row.profile_url),
    raw_text: normalizeWhitespace(row.raw_text),
  };
}

cli({
  site: 'linkedin',
  name: 'profile-projects',
  access: 'read',
  description: 'Read visible LinkedIn profile projects with descriptions, dates, skills, media, and URLs',
  domain: 'www.linkedin.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'profile-url', type: 'string', required: false, help: 'LinkedIn /in/<handle>/ profile URL. Defaults to /in/me/.' },
  ],
  columns: ['rank', 'title', 'date_range', 'associated_with', 'description', 'skills', 'media', 'urls', 'profile_url', 'raw_text'],
  func: async (page, args) => {
    if (!page) throw new CommandExecutionError('Browser session required for linkedin profile-projects');
    const profileUrl = normalizeProfileUrl(args['profile-url']);
    let projectsUrl;
    if (!args['profile-url'] || new URL(profileUrl).pathname === '/in/me/') {
      await page.goto(profileUrl);
      await page.wait(4);
      await assertLinkedInAuthenticated(page, 'LinkedIn profile-projects');
      const resolvedProfileUrl = unwrapEvaluateResult(await page.evaluate(String.raw`(() => {
        const current = new URL(location.href);
        if (/^\/in\/[^/?#]+\/?$/.test(current.pathname) && current.pathname !== '/in/me/') return current.toString();
        const ownProfileLink = Array.from(document.querySelectorAll('a[href^="/in/"]'))
          .map((link) => new URL(link.href, location.origin))
          .find((url) => /^\/in\/[^/?#]+\/?$/.test(url.pathname) && url.pathname !== '/in/me/');
        return ownProfileLink ? ownProfileLink.toString() : '';
      })()`));
      if (!resolvedProfileUrl) {
        throw new CommandExecutionError('LinkedIn profile-projects could not resolve /in/me/ to a profile URL');
      }
      projectsUrl = profileProjectsUrl(resolvedProfileUrl);
    } else {
      projectsUrl = profileProjectsUrl(profileUrl);
    }
    await page.goto(projectsUrl);
    await page.wait(5);
    await assertLinkedInAuthenticated(page, 'LinkedIn profile-projects');
    try {
      await page.wait({ text: 'Projects', timeout: 10000 });
    } catch {}
    await page.autoScroll({ times: 3, delayMs: 700 });
    await page.wait(1);
    const payload = unwrapEvaluateResult(await page.evaluate(buildProjectsExtractionScript()));
    if (!payload || !Array.isArray(payload.projectRows)) {
      throw new CommandExecutionError('LinkedIn profile-projects returned malformed extraction payload');
    }
    const rows = payload.projectRows.map(normalizeProject);
    if (rows.length === 0) {
      throw new EmptyResultError('linkedin profile-projects', 'No visible LinkedIn profile projects were found.');
    }
    return rows.map((row, index) => ({ ...row, rank: index + 1 }));
  },
});

export const __test__ = {
  normalizeProfileUrl,
  profileProjectsUrl,
  parseProjectText,
  parseProjectsSectionText,
  decodeLinkedInSafetyUrl,
  normalizeProject,
};
