import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';

export const NAUKRI_PROFILE_URL = 'https://www.naukri.com/mnjuser/profile';

export const PROFILE_COLUMNS = [
  'profile_url',
  'name',
  'current_title',
  'current_company',
  'profile_last_updated',
  'profile_completion',
  'photo_status',
  'location',
  'total_experience',
  'current_salary',
  'phone',
  'email',
  'notice_status',
  'resume_file',
  'resume_uploaded_on',
  'resume_headline',
  'key_skills',
  'employment',
  'education',
  'it_skills',
  'projects',
  'profile_summary',
  'accomplishments',
  'career_profile',
  'personal_details',
  'diversity_inclusion',
];

const SECTION_LABELS = [
  'Resume',
  'Resume headline',
  'Key skills',
  'Employment',
  'Education',
  'IT skills',
  'Projects',
  'Profile summary',
  'Accomplishments',
  'Career profile',
  'Personal details',
  'Diversity & inclusion',
];

function normalizeWhitespace(value) {
  return String(value ?? '')
    .replace(/[\u00a0\u202f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanLines(text) {
  return String(text ?? '')
    .split(/\n+/)
    .map(normalizeWhitespace)
    .filter(Boolean);
}

function lineMatchesLabel(line, label) {
  if (label === 'Resume') return line === label;
  return line === label || line.startsWith(`${label} `);
}

function findLastSectionIndex(lines, label) {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lineMatchesLabel(lines[i], label)) return i;
  }
  return -1;
}

function findNextSectionIndex(lines, startIndex) {
  for (let i = startIndex + 1; i < lines.length; i++) {
    if (SECTION_LABELS.some((label) => lineMatchesLabel(lines[i], label))) return i;
  }
  return lines.length;
}

function stripLeadingSectionLabel(text, label) {
  const value = normalizeWhitespace(text);
  if (value === label) return '';
  if (value.startsWith(`${label} `)) return normalizeWhitespace(value.slice(label.length));
  return value;
}

function readSection(lines, label) {
  const index = findLastSectionIndex(lines, label);
  if (index < 0) return '';
  const nextIndex = findNextSectionIndex(lines, index);
  const chunk = lines.slice(index, nextIndex).join(' ');
  return stripLeadingSectionLabel(chunk, label)
    .replace(/\beditOneTheme\b/g, '')
    .replace(/\bAdd details\b/g, '')
    .replace(/\bAdd project\b/g, '')
    .replace(/\bAdd employment\b/g, '')
    .replace(/\bAdd education\b/g, '')
    .replace(/\bAdd link to online professional profiles \(e\.g\. LinkedIn, etc\.\)\b/g, '')
    .replace(/\[Read More\]\(javascript:;\)/g, '')
    .replace(/\[Add\]\(javascript(?::void\(0\))?;?\)/g, '')
    .replace(/\[Add more info\]\(javascript:void\(0\)\)/g, '')
    .replace(/\[Add languages\]\(javascript:void\(0\)\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractProfileHeader(lines) {
  const quickLinksIndex = lines.findIndex((line) => line === 'Quick links');
  const headerLines = lines.slice(0, quickLinksIndex > 0 ? quickLinksIndex : lines.length);
  const lastUpdatedLine = headerLines.find((line) => /^Profile last updated\s*-/i.test(line)) || '';
  const completion = headerLines.find((line) => /^\d+\s*%$/.test(line)) || '';
  const photoStatus = headerLines.find((line) => /approval pending|approved|rejected/i.test(line)) || '';
  const email = headerLines.find((line) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(line)) || '';
  const phone = headerLines.find((line) => /^\+?\d[\d\s-]{7,}$/.test(line)) || '';
  const location = headerLines.find((line) => /,\s*(india|usa|united states|uk|canada)\b/i.test(line)) || '';
  const totalExperience = headerLines.find((line) => /Year\(s\)|Month\(s\)/i.test(line)) || '';
  const currentSalary = headerLines.find((line) => /₹|rs\.?|lakh|crore/i.test(line)) || '';
  const noticeStatus = headerLines.find((line) => /notice period|serving notice|available/i.test(line)) || '';
  const nameIndex = headerLines.findIndex((line) => line && !/naukri|jobs|companies|services|search jobs|approval pending|^\d+\s*%$/i.test(line));
  const name = nameIndex >= 0 ? headerLines[nameIndex] : '';
  const roleLine = nameIndex >= 0 ? headerLines[nameIndex + 1] || '' : '';
  const companyLine = nameIndex >= 0 ? headerLines[nameIndex + 2] || '' : '';
  const currentCompany = /^at\s+/i.test(companyLine) ? companyLine.replace(/^at\s+/i, '') : companyLine;

  return {
    name,
    current_title: roleLine,
    current_company: currentCompany,
    profile_last_updated: lastUpdatedLine.replace(/^Profile last updated\s*-\s*/i, ''),
    profile_completion: completion,
    photo_status: photoStatus,
    location,
    total_experience: totalExperience,
    current_salary: currentSalary,
    phone,
    email,
    notice_status: noticeStatus,
  };
}

function parseResumeSection(text) {
  const resume = normalizeWhitespace(text);
  const uploadedMatch = resume.match(/\bUploaded on\s+(.+?)(?:\s+(?:downloadOneTheme|deleteOneTheme|Choose file|Update resume|Supported Formats)|$)/i);
  const beforeUpload = uploadedMatch ? resume.slice(0, uploadedMatch.index).trim() : resume;
  const resumeFile = beforeUpload.split(/\s+/).find((part) => /\.pdf$|\.docx?$|\.rtf$/i.test(part)) || beforeUpload;
  return {
    resume_file: normalizeWhitespace(resumeFile),
    resume_uploaded_on: normalizeWhitespace(uploadedMatch?.[1] || ''),
  };
}

export function parseNaukriProfileText(payload) {
  const text = typeof payload === 'string' ? payload : payload?.text;
  const lines = cleanLines(text);
  const url = normalizeWhitespace(typeof payload === 'object' ? payload?.url : '');
  const title = normalizeWhitespace(typeof payload === 'object' ? payload?.title : '');
  const fullText = normalizeWhitespace(text).toLowerCase();
  if (!lines.length) {
    throw new CommandExecutionError('Naukri profile-read could not read page text');
  }
  if (/login|sign in/.test(title.toLowerCase()) && !/profile|resume headline|key skills/.test(fullText)) {
    throw new AuthRequiredError('naukri.com', 'Open https://www.naukri.com in the connected browser and sign in, then retry.');
  }

  const header = extractProfileHeader(lines);
  const resume = parseResumeSection(readSection(lines, 'Resume'));
  const row = {
    profile_url: url,
    ...header,
    ...resume,
    resume_headline: readSection(lines, 'Resume headline'),
    key_skills: readSection(lines, 'Key skills'),
    employment: readSection(lines, 'Employment'),
    education: readSection(lines, 'Education'),
    it_skills: readSection(lines, 'IT skills'),
    projects: readSection(lines, 'Projects'),
    profile_summary: readSection(lines, 'Profile summary'),
    accomplishments: readSection(lines, 'Accomplishments'),
    career_profile: readSection(lines, 'Career profile'),
    personal_details: readSection(lines, 'Personal details'),
    diversity_inclusion: readSection(lines, 'Diversity & inclusion'),
  };

  if (!row.name && !row.resume_headline && !row.key_skills) {
    throw new CommandExecutionError('Naukri profile-read could not find profile fields; the page structure may have changed.');
  }
  return Object.fromEntries(PROFILE_COLUMNS.map((column) => [column, normalizeWhitespace(row[column])]));
}

function buildProfileExtractionScript() {
  return String.raw`(() => ({
    url: window.location.href,
    title: document.title || '',
    text: document.body ? document.body.innerText || '' : ''
  }))()`;
}

cli({
  site: 'naukri',
  name: 'profile-read',
  access: 'read',
  description: 'Read the logged-in Naukri jobseeker profile sections from Mynaukri',
  domain: 'www.naukri.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [],
  columns: PROFILE_COLUMNS,
  func: async (page) => {
    if (!page) throw new CommandExecutionError('Browser session required for naukri profile-read');
    await page.goto(NAUKRI_PROFILE_URL);
    await page.wait(5);
    if (typeof page.autoScroll === 'function') {
      await page.autoScroll({ times: 5, delayMs: 500 });
      await page.wait(1);
    }
    let payload;
    try {
      payload = await page.evaluate(buildProfileExtractionScript());
    }
    catch (e) {
      throw new CommandExecutionError(`Failed to read Naukri profile DOM: ${e?.message ?? e}`, 'Open the Naukri profile page in the connected browser and retry.');
    }
    return [parseNaukriProfileText(payload)];
  },
});

export const __test__ = {
  normalizeWhitespace,
  parseResumeSection,
  parseNaukriProfileText,
};
