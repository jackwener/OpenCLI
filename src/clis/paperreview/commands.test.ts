import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockReadPdfFile,
  mockRequestJson,
  mockUploadPresignedPdf,
  mockValidateHelpfulness,
  mockParseYesNo,
} = vi.hoisted(() => ({
  mockReadPdfFile: vi.fn(),
  mockRequestJson: vi.fn(),
  mockUploadPresignedPdf: vi.fn(),
  mockValidateHelpfulness: vi.fn(),
  mockParseYesNo: vi.fn(),
}));

vi.mock('./utils.js', async () => {
  const actual = await vi.importActual<typeof import('./utils.js')>('./utils.js');
  return {
    ...actual,
    readPdfFile: mockReadPdfFile,
    requestJson: mockRequestJson,
    uploadPresignedPdf: mockUploadPresignedPdf,
    validateHelpfulness: mockValidateHelpfulness,
    parseYesNo: mockParseYesNo,
  };
});

import { getRegistry } from '../../registry.js';
import './submit.js';
import './review.js';
import './feedback.js';

describe('paperreview submit command', () => {
  beforeEach(() => {
    mockReadPdfFile.mockReset();
    mockRequestJson.mockReset();
    mockUploadPresignedPdf.mockReset();
    mockValidateHelpfulness.mockReset();
    mockParseYesNo.mockReset();
  });

  it('supports dry run without any remote request', async () => {
    const cmd = getRegistry().get('paperreview/submit');
    expect(cmd?.func).toBeTypeOf('function');

    mockReadPdfFile.mockResolvedValue({
      buffer: Buffer.from('%PDF'),
      fileName: 'paper.pdf',
      resolvedPath: '/tmp/paper.pdf',
      sizeBytes: 4096,
    });

    const result = await cmd!.func!(null as any, {
      pdf: './paper.pdf',
      email: 'wang2629651228@gmail.com',
      venue: 'RAL',
      'dry-run': true,
      'prepare-only': false,
    });

    expect(mockRequestJson).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 'dry-run',
      file: 'paper.pdf',
      email: 'wang2629651228@gmail.com',
      venue: 'RAL',
    });
  });

  it('treats explicit false flags as false and performs the real submission path', async () => {
    const cmd = getRegistry().get('paperreview/submit');
    expect(cmd?.func).toBeTypeOf('function');

    mockReadPdfFile.mockResolvedValue({
      buffer: Buffer.from('%PDF'),
      fileName: 'paper.pdf',
      resolvedPath: '/tmp/paper.pdf',
      sizeBytes: 4096,
    });
    mockRequestJson
      .mockResolvedValueOnce({
        response: { ok: true, status: 200 } as Response,
        payload: {
          success: true,
          presigned_url: 'https://upload.example.com',
          presigned_fields: { key: 'uploads/paper.pdf' },
          s3_key: 'uploads/paper.pdf',
        },
      })
      .mockResolvedValueOnce({
        response: { ok: true, status: 200 } as Response,
        payload: {
          success: true,
          token: 'tok_false',
          message: 'Submission accepted',
        },
      });

    const result = await cmd!.func!(null as any, {
      pdf: './paper.pdf',
      email: 'wang2629651228@gmail.com',
      venue: 'RAL',
      'dry-run': 'false',
      'prepare-only': 'false',
    });

    expect(mockUploadPresignedPdf).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      status: 'submitted',
      token: 'tok_false',
      review_url: 'https://paperreview.ai/review?token=tok_false',
    });
  });

  it('supports prepare-only without uploading the PDF', async () => {
    const cmd = getRegistry().get('paperreview/submit');
    expect(cmd?.func).toBeTypeOf('function');

    mockReadPdfFile.mockResolvedValue({
      buffer: Buffer.from('%PDF'),
      fileName: 'paper.pdf',
      resolvedPath: '/tmp/paper.pdf',
      sizeBytes: 4096,
    });
    mockRequestJson.mockResolvedValueOnce({
      response: { ok: true, status: 200 } as Response,
      payload: {
        success: true,
        presigned_url: 'https://upload.example.com',
        presigned_fields: { key: 'uploads/paper.pdf' },
        s3_key: 'uploads/paper.pdf',
      },
    });

    const result = await cmd!.func!(null as any, {
      pdf: './paper.pdf',
      email: 'wang2629651228@gmail.com',
      venue: 'RAL',
      'dry-run': 'false',
      'prepare-only': 'true',
    });

    expect(mockUploadPresignedPdf).not.toHaveBeenCalled();
    expect(mockRequestJson).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      status: 'prepared',
      s3_key: 'uploads/paper.pdf',
    });
  });

  it('requests an upload URL, uploads the PDF, and confirms the submission', async () => {
    const cmd = getRegistry().get('paperreview/submit');
    expect(cmd?.func).toBeTypeOf('function');

    mockReadPdfFile.mockResolvedValue({
      buffer: Buffer.from('%PDF'),
      fileName: 'paper.pdf',
      resolvedPath: '/tmp/paper.pdf',
      sizeBytes: 4096,
    });
    mockRequestJson
      .mockResolvedValueOnce({
        response: { ok: true, status: 200 } as Response,
        payload: {
          success: true,
          presigned_url: 'https://upload.example.com',
          presigned_fields: { key: 'uploads/paper.pdf' },
          s3_key: 'uploads/paper.pdf',
        },
      })
      .mockResolvedValueOnce({
        response: { ok: true, status: 200 } as Response,
        payload: {
          success: true,
          token: 'tok_123',
          message: 'Submission accepted',
        },
      });

    const result = await cmd!.func!(null as any, {
      pdf: './paper.pdf',
      email: 'wang2629651228@gmail.com',
      venue: 'RAL',
      'dry-run': false,
      'prepare-only': false,
    });

    expect(mockRequestJson).toHaveBeenNthCalledWith(1, '/api/get-upload-url', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        filename: 'paper.pdf',
        venue: 'RAL',
      }),
    }));
    expect(mockUploadPresignedPdf).toHaveBeenCalledWith(
      'https://upload.example.com',
      expect.objectContaining({ fileName: 'paper.pdf' }),
      expect.objectContaining({ s3_key: 'uploads/paper.pdf' }),
    );
    expect(mockRequestJson).toHaveBeenNthCalledWith(2, '/api/confirm-upload', expect.objectContaining({
      method: 'POST',
      body: expect.any(FormData),
    }));
    expect(result).toMatchObject({
      status: 'submitted',
      token: 'tok_123',
      review_url: 'https://paperreview.ai/review?token=tok_123',
    });
  });
});

describe('paperreview review command', () => {
  beforeEach(() => {
    mockRequestJson.mockReset();
  });

  it('returns processing status when the review is not ready yet', async () => {
    const cmd = getRegistry().get('paperreview/review');
    expect(cmd?.func).toBeTypeOf('function');

    mockRequestJson.mockResolvedValue({
      response: { status: 202 } as Response,
      payload: { detail: 'Review is still processing.' },
    });

    const result = await cmd!.func!(null as any, { token: 'tok_123' });

    expect(result).toMatchObject({
      status: 'processing',
      token: 'tok_123',
      review_url: 'https://paperreview.ai/review?token=tok_123',
      message: 'Review is still processing.',
    });
  });
});

describe('paperreview feedback command', () => {
  beforeEach(() => {
    mockRequestJson.mockReset();
    mockValidateHelpfulness.mockReset();
    mockParseYesNo.mockReset();
  });

  it('normalizes feedback inputs and posts them to the API', async () => {
    const cmd = getRegistry().get('paperreview/feedback');
    expect(cmd?.func).toBeTypeOf('function');

    mockValidateHelpfulness.mockReturnValue(4);
    mockParseYesNo.mockReturnValueOnce(true).mockReturnValueOnce(false);
    mockRequestJson.mockResolvedValue({
      response: { ok: true, status: 200 } as Response,
      payload: { message: 'Thanks for the feedback.' },
    });

    const result = await cmd!.func!(null as any, {
      token: 'tok_123',
      helpfulness: 4,
      'critical-error': 'yes',
      'actionable-suggestions': 'no',
      'additional-comments': 'Helpful summary, but the contribution section needs more detail.',
    });

    expect(mockRequestJson).toHaveBeenCalledWith('/api/feedback/tok_123', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        helpfulness: 4,
        has_critical_error: true,
        has_actionable_suggestions: false,
        additional_comments: 'Helpful summary, but the contribution section needs more detail.',
      }),
    });
    expect(result).toMatchObject({
      status: 'submitted',
      token: 'tok_123',
      helpfulness: 4,
      critical_error: true,
      actionable_suggestions: false,
      message: 'Thanks for the feedback.',
    });
  });
});
