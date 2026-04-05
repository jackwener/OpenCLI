import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';
import {
  PAPERREVIEW_DOMAIN,
  ensureApiSuccess,
  ensureSuccess,
  normalizeVenue,
  readPdfFile,
  requestJson,
  summarizeSubmission,
  uploadPresignedPdf,
} from './utils.js';

cli({
  site: 'paperreview',
  name: 'submit',
  description: 'Submit a PDF to paperreview.ai for review',
  domain: PAPERREVIEW_DOMAIN,
  strategy: Strategy.PUBLIC,
  browser: false,
  timeoutSeconds: 120,
  args: [
    { name: 'pdf', positional: true, required: true, help: 'Path to the paper PDF' },
    { name: 'email', required: true, help: 'Email address for the submission' },
    { name: 'venue', help: 'Optional target venue such as ICLR or NeurIPS' },
    { name: 'dry-run', type: 'bool', default: false, help: 'Validate the input and stop before remote submission' },
    { name: 'prepare-only', type: 'bool', default: false, help: 'Request an upload slot but stop before uploading the PDF' },
  ],
  columns: ['status', 'file', 'email', 'venue', 'token', 'review_url', 'message'],
  footerExtra: (kwargs) => {
    if (kwargs['dry-run'] === true) return 'dry run only';
    if (kwargs['prepare-only'] === true) return 'prepared only';
    return undefined;
  },
  func: async (_page, kwargs) => {
    const pdfFile = await readPdfFile(kwargs.pdf);
    const email = String(kwargs.email ?? '').trim();
    const venue = normalizeVenue(kwargs.venue);
    const dryRun = kwargs['dry-run'] === true;
    const prepareOnly = kwargs['prepare-only'] === true;

    if (!email) {
      throw new CliError('ARGUMENT', 'An email address is required.', 'Pass --email <address>');
    }

    if (dryRun) {
      return summarizeSubmission({
        pdfFile,
        email,
        venue,
        message: 'Input validation passed. No remote request was sent.',
        dryRun: true,
      });
    }

    const { response: uploadUrlResponse, payload: uploadUrlPayload } = await requestJson('/api/get-upload-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: pdfFile.fileName,
        venue,
      }),
    });
    ensureSuccess(
      uploadUrlResponse,
      uploadUrlPayload,
      'Failed to request an upload URL.',
      'Try again in a moment',
    );
    ensureApiSuccess(
      uploadUrlPayload,
      'paperreview.ai did not return a usable upload URL.',
      'Try again in a moment',
    );

    if (prepareOnly) {
      return summarizeSubmission({
        pdfFile,
        email,
        venue,
        message: 'Upload slot prepared. The PDF was not uploaded and no submission was confirmed.',
        s3Key: uploadUrlPayload.s3_key,
        status: 'prepared',
      });
    }

    await uploadPresignedPdf(uploadUrlPayload.presigned_url, pdfFile, uploadUrlPayload);

    const confirmForm = new FormData();
    confirmForm.append('s3_key', uploadUrlPayload.s3_key);
    confirmForm.append('venue', venue);
    confirmForm.append('email', email);

    const { response: confirmResponse, payload: confirmPayload } = await requestJson('/api/confirm-upload', {
      method: 'POST',
      body: confirmForm,
    });
    ensureSuccess(
      confirmResponse,
      confirmPayload,
      'Failed to confirm the upload with paperreview.ai.',
      'Try again in a moment',
    );
    ensureApiSuccess(
      confirmPayload,
      'paperreview.ai did not confirm the submission.',
      'Try again in a moment',
    );

    return summarizeSubmission({
      pdfFile,
      email,
      venue,
      token: confirmPayload.token,
      message: confirmPayload.message,
      s3Key: uploadUrlPayload.s3_key,
    });
  },
});
