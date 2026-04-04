/**
 * ImageX cover image uploader.
 *
 * Uploads a JPEG/PNG image to ByteDance ImageX via a pre-signed PUT URL
 * obtained from the Douyin "apply cover upload" API.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { CommandExecutionError } from '../../../src/errors.js';

export interface ImageXUploadInfo {
  /** Pre-signed PUT target URL (provided by the apply cover upload API) */
  upload_url: string;
  /** Image URI to use in create_v2 (returned from the apply step) */
  store_uri: string;
}

/**
 * Detect MIME type from file extension.
 * Falls back to image/jpeg for unknown extensions.
 */
function detectContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.png':
      return 'image/png';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    default:
      return 'image/jpeg';
  }
}

/**
 * Upload a cover image to ByteDance ImageX via a pre-signed PUT URL.
 *
 * @param imagePath - Local file path to the image (JPEG/PNG/etc.)
 * @param uploadInfo - Upload URL and store_uri from the apply cover upload API
 * @returns The store_uri (= image_uri for use in create_v2)
 */
export async function imagexUpload(
  imagePath: string,
  uploadInfo: ImageXUploadInfo,
): Promise<string> {
  if (!fs.existsSync(imagePath)) {
    throw new CommandExecutionError(
      `Cover image file not found: ${imagePath}`,
      'Ensure the file path is correct and accessible.',
    );
  }

  const imageBuffer = fs.readFileSync(imagePath);
  const contentType = detectContentType(imagePath);

  const res = await fetch(uploadInfo.upload_url, {
    method: 'PUT',
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(imageBuffer.byteLength),
    },
    body: imageBuffer as unknown as BodyInit,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new CommandExecutionError(
      `ImageX upload failed with status ${res.status}: ${body}`,
      'Check that the upload URL is valid and has not expired.',
    );
  }

  return uploadInfo.store_uri;
}
