/**
 * `opencli suno download <clip-id>` — download an already-generated clip in
 * one or more formats. Useful for grabbing assets from songs created via the
 * Suno web UI or earlier opencli runs without re-generating.
 *
 * WAV downloads still trigger Suno's per-download billing (the same charge
 * the web UI's "Download → WAV" flow makes).
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import {
    STUDIO_API,
    SUNO_DOMAIN,
    SUNO_URL,
    downloadSunoClip,
    ensureSunoSession,
    parseFormats,
    resolveSunoOutputDir,
} from './utils.js';

import * as os from 'node:os';

function displayPath(filePath) {
    if (!filePath) return '-';
    const home = os.homedir();
    return filePath.startsWith(home) ? `~${filePath.slice(home.length)}` : filePath;
}

function parseClipId(value) {
    const raw = String(value || '').trim();
    if (!raw) throw new ArgumentError('clip-id required (UUID or /song/<id> URL)');
    const m = raw.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    if (m) return m[1].toLowerCase();
    throw new ArgumentError(`Invalid clip-id: ${raw}`, 'Pass a UUID or a https://suno.com/song/<uuid> URL.');
}

export const downloadCommand = cli({
    site: 'suno',
    name: 'download',
    access: 'write',
    description: 'Download an existing Suno clip (MP3 + optional WAV/M4A/video) by id',
    domain: SUNO_DOMAIN,
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    navigateBefore: false,
    defaultFormat: 'plain',
    args: [
        { name: 'clip', positional: true, required: true, help: 'Clip UUID or https://suno.com/song/<id> URL' },
        { name: 'formats', help: 'Comma-separated formats: mp3, m4a, wav, video, cover, metadata. Default: mp3,metadata' },
        { name: 'op', help: 'Output directory (default: ~/Music/suno)' },
        { name: 'confirm-paid', type: 'boolean', default: false, help: 'Required to allow paid downloads (wav). Without it, paid formats are skipped with a warning.' },
    ],
    columns: ['status', 'clip', 'title', 'files', 'link'],
    func: async (page, kwargs) => {
        const clipId = parseClipId(kwargs.clip);
        const requestedFormats = parseFormats(kwargs.formats);
        const confirmPaid = String(kwargs['confirm-paid'] ?? '').toLowerCase() === 'true' || kwargs['confirm-paid'] === true;
        const PAID_FORMATS = new Set(['wav']);
        const skippedPaid = [];
        const formats = requestedFormats.filter(f => {
            if (PAID_FORMATS.has(f) && !confirmPaid) {
                skippedPaid.push(f);
                return false;
            }
            return true;
        });
        const outputDir = resolveSunoOutputDir(kwargs.op);

        const session = await ensureSunoSession(page);
        const deviceId = session.deviceId;

        // Pull the clip object from feed/v3 so audio_url/media_urls/has_stem are current.
        const feedRes = await page.evaluate(`(async () => {
            const browserToken = JSON.stringify({ token: btoa(JSON.stringify({ timestamp: Date.now() })) });
            const res = await fetch('${STUDIO_API}/api/feed/v3', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer ' + (await window.Clerk.session.getToken()),
                    'browser-token': browserToken,
                    'device-id': ${JSON.stringify(deviceId)},
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ clip_ids: ['${clipId}'] }),
            });
            const body = await res.json().catch(() => null);
            return { status: res.status, body };
        })()`);

        if (feedRes?.status !== 200) {
            throw new CommandExecutionError(`Suno feed lookup failed (HTTP ${feedRes?.status || '?'}).`);
        }
        const clip = (feedRes.body?.clips || []).find(c => c.id === clipId);
        if (!clip) {
            throw new EmptyResultError('suno download', `Clip ${clipId} not found in your account. Confirm at ${SUNO_URL}/song/${clipId}.`);
        }
        if (clip.status !== 'complete') {
            throw new CommandExecutionError(`Clip ${clipId} status is "${clip.status}" — not complete yet. Retry once generation finishes.`);
        }

        const result = await downloadSunoClip(page, clip, outputDir, formats, deviceId);
        const link = `${SUNO_URL}/song/${clip.id}`;
        const writtenSummary = result.written
            .map(w => w.ok ? `${w.format}:${displayPath(w.file)}` : `${w.format}:✗(${w.reason})`)
            .join(' | ');
        const skippedSummary = skippedPaid.length
            ? ` | skipped(needs --confirm-paid):${skippedPaid.join(',')}`
            : '';
        const fileSummary = `${writtenSummary}${skippedSummary}`;
        const anyFailed = result.written.some(w => !w.ok);

        return [{
            status: anyFailed ? '⚠ partial' : '✅ saved',
            clip: clip.id.slice(0, 8),
            title: clip.title || '(untitled)',
            files: `📁 ${fileSummary}`,
            link: `🔗 ${link}`,
        }];
    },
});
