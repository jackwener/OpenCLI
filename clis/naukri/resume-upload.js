import * as fs from 'node:fs';
import * as path from 'node:path';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { ensureProfilePage, normalizeWhitespace, readProfile } from './shared.js';

const MAX_RESUME_BYTES = 2 * 1024 * 1024;
const SUPPORTED_EXTENSIONS = new Set(['.doc', '.docx', '.rtf', '.pdf']);

function requireResumePath(value) {
  const filePath = path.resolve(String(value || '').trim());
  if (!filePath) throw new ArgumentError('file is required');
  if (!fs.existsSync(filePath)) throw new ArgumentError(`Resume file not found: ${filePath}`);
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new ArgumentError(`Resume path is not a file: ${filePath}`);
  const ext = path.extname(filePath).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    throw new ArgumentError(`Unsupported resume format: ${ext || '(none)'}`, 'Supported formats: doc, docx, rtf, pdf');
  }
  if (stat.size > MAX_RESUME_BYTES) {
    throw new ArgumentError(`Resume file is too large: ${stat.size} bytes`, 'Naukri supports resume files up to 2 MB');
  }
  return filePath;
}

function buildFindResumeInputScript() {
  return String.raw`(() => {
    const visible = (el) => {
      const rect = el && el.getBoundingClientRect ? el.getBoundingClientRect() : null;
      return !!rect && rect.width > 0 && rect.height > 0;
    };
    const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
    const input = inputs.find((el) => {
      const accept = String(el.getAttribute('accept') || '').toLowerCase();
      return accept.includes('pdf') || accept.includes('doc') || accept.includes('rtf') || visible(el);
    }) || inputs[0];
    if (!input) return null;
    input.setAttribute('data-opencli-naukri-resume-input', 'true');
    input.scrollIntoView({ block: 'center', inline: 'center' });
    return 'input[data-opencli-naukri-resume-input="true"]';
  })()`;
}

function buildClickResumeUpdateScript() {
  return String.raw`(() => {
    const clean = (value) => String(value || '').replace(/[\u00a0\u202f]+/g, ' ').replace(/\s+/g, ' ').trim();
    const visible = (el) => {
      const rect = el && el.getBoundingClientRect ? el.getBoundingClientRect() : null;
      return !!rect && rect.width > 0 && rect.height > 0;
    };
    const buttons = Array.from(document.querySelectorAll('button,a,[role="button"],input[type="submit"]'));
    const candidates = buttons.filter((el) => /update resume|yes,\s*upload new/i.test(clean(el.innerText || el.value || el.textContent)));
    const update = candidates.find(visible) || candidates[0];
    if (!update) return { ok: false, error: 'update_resume_button_not_found' };
    update.scrollIntoView({ block: 'center', inline: 'center' });
    update.click();
    return { ok: true };
  })()`;
}

function buildDispatchResumeInputScript(selector) {
  return `
    (() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      if (!input) return { ok: false, error: 'resume_input_not_found' };
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return {
        ok: true,
        files: Array.from(input.files || []).map((file) => file.name || ''),
      };
    })()
  `;
}

cli({
  site: 'naukri',
  name: 'resume-upload',
  access: 'write',
  description: 'Upload a resume file to the logged-in Naukri profile and verify the uploaded filename',
  domain: 'www.naukri.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'file', positional: true, required: true, help: 'Resume file path (doc, docx, rtf, pdf; max 2 MB)' },
  ],
  columns: ['status', 'resume_file', 'resume_uploaded_on'],
  func: async (page, kwargs) => {
    const filePath = requireResumePath(kwargs.file);
    await ensureProfilePage(page);
    const selector = await page.evaluate(buildFindResumeInputScript());
    if (!selector) throw new CommandExecutionError('Could not find Naukri resume file input');

    if (typeof page.setFileInput === 'function') {
      await page.setFileInput([filePath], selector);
    } else if (typeof page.uploadFiles === 'function') {
      await page.uploadFiles(selector, [filePath]);
    } else {
      throw new CommandExecutionError('Resume upload requires browser file input support');
    }

    await page.evaluate(buildDispatchResumeInputScript(selector));
    await page.wait(2);
    const clicked = await page.evaluate(buildClickResumeUpdateScript());
    if (!clicked?.ok) {
      throw new CommandExecutionError(`Could not submit Naukri resume upload: ${clicked?.error || 'unknown'}`);
    }
    await page.wait(5);
    const row = await readProfile(page);
    const expectedName = path.basename(filePath);
    const actualName = normalizeWhitespace(row.resume_file);
    if (actualName !== expectedName) {
      throw new CommandExecutionError('Naukri resume filename did not match after upload', `Expected "${expectedName}", got "${actualName}"`);
    }
    return [{
      status: 'uploaded',
      resume_file: actualName,
      resume_uploaded_on: row.resume_uploaded_on,
    }];
  },
});

export const __test__ = {
  MAX_RESUME_BYTES,
  SUPPORTED_EXTENSIONS,
  requireResumePath,
};
