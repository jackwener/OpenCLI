/**
 * ImageX cover image uploader.
 *
 * Apply → PUT → Commit, the same flow the creator center's uploader uses:
 * ApplyImageUpload / CommitImageUpload are ImageX OpenAPI calls signed (AWS4,
 * service "imagex") with the upload auth v5 credentials that also sign the
 * video upload, and the image bytes are PUT with the per-object store auth.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { computeAws4Headers } from './vod-upload.js';
import { crc32Hex } from './tos-upload.js';
const IMAGEX_HOST = 'https://imagex.bytedanceapi.com/';
/**
 * ImageX service the creator center uploads covers to
 * (`imageConfig.serviceId` in its uploader config).
 */
export const COVER_SERVICE_ID = 'jm8ajry58r';
/**
 * Detect MIME type from file extension.
 * Falls back to image/jpeg for unknown extensions.
 */
function detectContentType(filePath) {
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
async function imagexOpenApi(action, credentials, { serviceId, query = {}, body } = {}) {
    const params = new URLSearchParams({ Action: action, Version: '2018-08-01', ServiceId: serviceId, ...query });
    const url = `${IMAGEX_HOST}?${params.toString()}`;
    const init = body === undefined
        ? { headers: computeAws4Headers(url, credentials, { service: 'imagex' }) }
        : {
            method: 'POST',
            body,
            headers: computeAws4Headers(url, credentials, {
                service: 'imagex',
                method: 'POST',
                body,
                headers: { 'content-type': 'application/json' },
            }),
        };
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(30000) });
    const text = await res.text();
    let payload;
    try {
        payload = JSON.parse(text);
    }
    catch {
        throw new CommandExecutionError(`ImageX ${action} returned a non-JSON response: HTTP ${res.status} ${text.slice(0, 300)}`);
    }
    const error = payload?.ResponseMetadata?.Error;
    if (!res.ok || error) {
        throw new CommandExecutionError(`ImageX ${action} failed: HTTP ${res.status} ${JSON.stringify(error ?? payload).slice(0, 300)}`);
    }
    return payload?.Result ?? {};
}
/**
 * Apply for a cover upload slot.
 *
 * @param credentials - upload auth v5 credentials (see getUploadAuthV5Credentials)
 * @returns upload_url / store_uri / auth for imagexUpload, session_key for commitImageUpload
 */
export async function applyImageUpload(credentials, { serviceId = COVER_SERVICE_ID, fileExtension } = {}) {
    const result = await imagexOpenApi('ApplyImageUpload', credentials, {
        serviceId,
        query: { UploadNum: '1', ...(fileExtension ? { FileExtension: fileExtension } : {}) },
    });
    const address = result.UploadAddress;
    const storeInfo = address?.StoreInfos?.[0];
    const uploadHost = address?.UploadHosts?.[0];
    if (!storeInfo?.StoreUri || !storeInfo?.Auth || !uploadHost || !address?.SessionKey) {
        throw new CommandExecutionError(`ImageX ApplyImageUpload response is missing upload fields: ${JSON.stringify(result).slice(0, 500)}`);
    }
    return {
        upload_url: `https://${uploadHost}/${storeInfo.StoreUri}`,
        store_uri: storeInfo.StoreUri,
        auth: storeInfo.Auth,
        session_key: address.SessionKey,
    };
}
/**
 * Commit an uploaded cover; returns the image uri and its size for create_v2.
 */
export async function commitImageUpload(credentials, sessionKey, { serviceId = COVER_SERVICE_ID } = {}) {
    const result = await imagexOpenApi('CommitImageUpload', credentials, {
        serviceId,
        body: JSON.stringify({ SessionKey: sessionKey }),
    });
    const item = result.Results?.[0];
    const info = result.PluginResult?.[0] ?? {};
    if (!item?.Uri || item.UriStatus !== 2000) {
        throw new CommandExecutionError(`ImageX CommitImageUpload did not confirm the cover: ${JSON.stringify(result).slice(0, 500)}`);
    }
    return {
        uri: item.Uri,
        width: Number(info.ImageWidth) || 0,
        height: Number(info.ImageHeight) || 0,
    };
}
/**
 * Upload a cover image to ByteDance ImageX.
 *
 * @param imagePath - Local file path to the image (JPEG/PNG/etc.)
 * @param uploadInfo - upload_url, store_uri and (from applyImageUpload) the store auth
 * @returns The store_uri (= image_uri for use in create_v2)
 */
export async function imagexUpload(imagePath, uploadInfo) {
    if (!fs.existsSync(imagePath)) {
        throw new CommandExecutionError(`Cover image file not found: ${imagePath}`, 'Ensure the file path is correct and accessible.');
    }
    const imageBuffer = fs.readFileSync(imagePath);
    const contentType = detectContentType(imagePath);
    const res = await fetch(uploadInfo.upload_url, {
        method: 'PUT',
        headers: {
            'Content-Type': contentType,
            'Content-Length': String(imageBuffer.byteLength),
            ...(uploadInfo.auth ? { Authorization: uploadInfo.auth, 'Content-CRC32': crc32Hex(imageBuffer) } : {}),
        },
        body: imageBuffer,
    });
    const body = await res.text().catch(() => '');
    if (!res.ok) {
        throw new CommandExecutionError(`ImageX upload failed with status ${res.status}: ${body}`, 'Check that the upload URL is valid and has not expired.');
    }
    // The upload host answers HTTP 200 with an error code in the body (e.g. 4004 for a wrong path).
    let payload = null;
    try {
        payload = body ? JSON.parse(body) : null;
    }
    catch {
        payload = null;
    }
    const errorCode = payload?.error?.error_code ?? (typeof payload?.code === 'number' && payload.code !== 200 ? payload.code : 0);
    if (errorCode) {
        throw new CommandExecutionError(`ImageX upload failed with error ${errorCode}: ${body.slice(0, 300)}`, 'Check that the upload URL is valid and has not expired.');
    }
    return uploadInfo.store_uri;
}
