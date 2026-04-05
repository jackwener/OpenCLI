import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CliError } from '@jackwener/opencli/errors';
import {
  MAX_PDF_BYTES,
  buildReviewUrl,
  parseYesNo,
  readPdfFile,
  requestJson,
  validateHelpfulness,
} from './utils.js';

describe('paperreview utils', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('builds review URLs from the token', () => {
    expect(buildReviewUrl('tok 123')).toBe('https://paperreview.ai/review?token=tok%20123');
  });

  it('parses yes/no flags', () => {
    expect(parseYesNo('yes', 'critical-error')).toBe(true);
    expect(parseYesNo('NO', 'critical-error')).toBe(false);
  });

  it('rejects invalid yes/no flags with CliError', () => {
    expect(() => parseYesNo('maybe', 'critical-error')).toThrow(CliError);
    expect(() => parseYesNo('maybe', 'critical-error')).toThrow('"critical-error" must be either "yes" or "no".');
  });

  it('validates helpfulness scores', () => {
    expect(validateHelpfulness(5)).toBe(5);
    expect(() => validateHelpfulness(0)).toThrow(CliError);
  });

  it('reads a valid PDF file and returns metadata', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'paperreview-'));
    const pdfPath = path.join(tempDir, 'sample.pdf');
    const pdfBytes = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(256, 1)]);
    await fs.writeFile(pdfPath, pdfBytes);

    const result = await readPdfFile(pdfPath);

    expect(result.fileName).toBe('sample.pdf');
    expect(result.resolvedPath).toBe(pdfPath);
    expect(result.sizeBytes).toBe(pdfBytes.length);
    expect(result.buffer.equals(pdfBytes)).toBe(true);
  });

  it('rejects PDFs larger than the paperreview.ai size limit', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'paperreview-'));
    const pdfPath = path.join(tempDir, 'large.pdf');
    await fs.writeFile(pdfPath, Buffer.alloc(MAX_PDF_BYTES + 1, 1));

    await expect(readPdfFile(pdfPath)).rejects.toThrow(CliError);
    await expect(readPdfFile(pdfPath)).rejects.toThrow('The PDF is larger than paperreview.ai\'s 10MB limit.');
  });

  it('normalizes fetch failures into CliError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('socket hang up')));

    await expect(requestJson('/api/review/token')).rejects.toThrow(CliError);
    await expect(requestJson('/api/review/token')).rejects.toThrow('Unable to reach paperreview.ai');
  });
});
