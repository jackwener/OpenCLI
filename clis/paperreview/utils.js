import fs from 'node:fs/promises';
import path from 'node:path';
import { CliError, getErrorMessage } from '@jackwener/opencli/errors';
export const PAPERREVIEW_DOMAIN = 'paperreview.ai';
export const PAPERREVIEW_BASE_URL = `https://${PAPERREVIEW_DOMAIN}`;
export const MAX_PDF_BYTES = 10 * 1024 * 1024;
function asText(value) {
    return value == null ? '' : String(value);
}
function trimOrEmpty(value) {
    return asText(value).trim();
}
function toErrorMessage(payload, fallback) {
    if (payload && typeof payload === 'object') {
        const detail = trimOrEmpty(payload.detail);
        const message = trimOrEmpty(payload.message);
        const error = trimOrEmpty(payload.error);
        if (detail)
            return detail;
        if (message)
            return message;
        if (error)
            return error;
    }
    const text = trimOrEmpty(payload);
    return text || fallback;
}
export function buildReviewUrl(token) {
    return `${PAPERREVIEW_BASE_URL}/review?token=${encodeURIComponent(token)}`;
}
export function parseYesNo(value, name) {
    const normalized = trimOrEmpty(value).toLowerCase();
    if (normalized === 'yes')
        return true;
    if (normalized === 'no')
        return false;
    throw new CliError('ARGUMENT', `"${name}" must be either "yes" or "no".`);
}
export function normalizeVenue(value) {
    return trimOrEmpty(value);
}
export function validateHelpfulness(value) {
    const numeric = Number(value);
    if (!Number.isInteger(numeric) || numeric < 1 || numeric > 5) {
        throw new CliError('ARGUMENT', '"helpfulness" must be an integer from 1 to 5.');
    }
    return numeric;
}
export async function readPdfFile(inputPath) {
    const rawPath = trimOrEmpty(inputPath);
    if (!rawPath) {
        throw new CliError('ARGUMENT', 'A PDF path is required.', 'Provide a local PDF file path');
    }
    const resolvedPath = path.resolve(rawPath);
    const fileName = path.basename(resolvedPath);
    if (!fileName.toLowerCase().endsWith('.pdf')) {
        throw new CliError('ARGUMENT', 'The input file must end with .pdf.', 'Provide a PDF file path');
    }
    let fileStat;
    try {
        fileStat = await fs.stat(resolvedPath);
    }
    catch (error) {
        if (error?.code === 'ENOENT') {
            throw new CliError('FILE_NOT_FOUND', `File not found: ${resolvedPath}`, 'Provide a valid PDF file path');
        }
        throw new CliError('FILE_READ_ERROR', `Unable to inspect file: ${resolvedPath}`, 'Check file permissions and try again');
    }
    if (!fileStat.isFile()) {
        throw new CliError('FILE_NOT_FOUND', `Not a file: ${resolvedPath}`, 'Provide a valid PDF file path');
    }
    if (fileStat.size < 100) {
        throw new CliError('ARGUMENT', 'The PDF is too small. paperreview.ai requires at least 100 bytes.', 'Provide the final paper PDF');
    }
    if (fileStat.size > MAX_PDF_BYTES) {
        throw new CliError('FILE_TOO_LARGE', 'The PDF is larger than paperreview.ai\'s 10MB limit.', 'Compress the PDF or submit a smaller file');
    }
    let buffer;
    try {
        buffer = await fs.readFile(resolvedPath);
    }
    catch {
        throw new CliError('FILE_READ_ERROR', `Unable to read file: ${resolvedPath}`, 'Check file permissions and try again');
    }
    return {
        buffer,
        fileName,
        resolvedPath,
        sizeBytes: buffer.byteLength,
    };
}
export async function requestJson(pathname, init = {}) {
    let response;
    try {
        response = await fetch(`${PAPERREVIEW_BASE_URL}${pathname}`, init);
    }
    catch (error) {
        throw new CliError('FETCH_ERROR', `Unable to reach paperreview.ai: ${getErrorMessage(error)}`, 'Check your network connection and try again');
    }
    const rawText = await response.text();
    let payload = rawText;
    if (rawText) {
        try {
            payload = JSON.parse(rawText);
        }
        catch {
            payload = rawText;
        }
    }
    return { response, payload };
}
export function ensureSuccess(response, payload, fallback, hint) {
    if (!response.ok) {
        const code = response.status === 404 ? 'NOT_FOUND' : 'API_ERROR';
        throw new CliError(code, toErrorMessage(payload, fallback), hint);
    }
}
export function ensureApiSuccess(payload, fallback, hint) {
    if (!payload || typeof payload !== 'object' || payload.success !== true) {
        throw new CliError('API_ERROR', toErrorMessage(payload, fallback), hint);
    }
}
export function createUploadForm(urlData, pdfFile) {
    const form = new FormData();
    for (const [key, value] of Object.entries(urlData.presigned_fields ?? {})) {
        form.append(key, value);
    }
    form.append('file', new Blob([new Uint8Array(pdfFile.buffer)], { type: 'application/pdf' }), pdfFile.fileName);
    return form;
}
export async function uploadPresignedPdf(presignedUrl, pdfFile, urlData) {
    let response;
    try {
        response = await fetch(presignedUrl, {
            method: 'POST',
            body: createUploadForm(urlData, pdfFile),
        });
    }
    catch (error) {
        throw new CliError('UPLOAD_ERROR', `S3 upload failed: ${getErrorMessage(error)}`, 'Try again in a moment');
    }
    if (!response.ok) {
        const body = await response.text();
        throw new CliError('UPLOAD_ERROR', body || `S3 upload failed with status ${response.status}.`, 'Try again in a moment');
    }
}
export function summarizeSubmission(options) {
    const { pdfFile, email, venue, token, message, s3Key, dryRun = false, status } = options;
    return {
        status: status ?? (dryRun ? 'dry-run' : 'submitted'),
        file: pdfFile.fileName,
        file_path: pdfFile.resolvedPath,
        size_bytes: pdfFile.sizeBytes,
        email,
        venue,
        token: token ?? '',
        review_url: token ? buildReviewUrl(token) : '',
        message: message ?? '',
        s3_key: s3Key ?? '',
    };
}
export function summarizeReview(token, payload, status = 'ready') {
    const sections = payload?.sections ?? {};
    const availableSections = Object.keys(sections);
    return {
        status,
        token,
        review_url: buildReviewUrl(token),
        title: trimOrEmpty(payload?.title),
        venue: trimOrEmpty(payload?.venue),
        submission_date: trimOrEmpty(payload?.submission_date),
        numerical_score: payload?.numerical_score ?? '',
        has_feedback: payload?.has_feedback ?? '',
        available_sections: availableSections.join(', '),
        section_count: availableSections.length,
        summary: trimOrEmpty(sections.summary),
        strengths: trimOrEmpty(sections.strengths),
        weaknesses: trimOrEmpty(sections.weaknesses),
        detailed_comments: trimOrEmpty(sections.detailed_comments),
        questions: trimOrEmpty(sections.questions),
        assessment: trimOrEmpty(sections.assessment),
        content: trimOrEmpty(payload?.content),
        sections,
    };
}
export function summarizeFeedback(options) {
    const { token, helpfulness, criticalError, actionableSuggestions, comments, payload } = options;
    return {
        status: 'submitted',
        token,
        helpfulness,
        critical_error: criticalError,
        actionable_suggestions: actionableSuggestions,
        additional_comments: comments,
        message: trimOrEmpty(payload?.message) || 'Feedback submitted.',
    };
}
