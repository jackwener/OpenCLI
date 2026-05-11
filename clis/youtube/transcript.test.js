import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const transcriptSource = readFileSync(resolve(__dirname, 'transcript.js'), 'utf8');

describe('youtube transcript source contract', () => {
    it('gets caption tracks from watch page bootstrap data, not Android InnerTube', () => {
        expect(transcriptSource).toContain("fetch('/watch?v='");
        expect(transcriptSource).toContain("extractJsonAssignmentFromHtml(html, 'ytInitialPlayerResponse')");
        expect(transcriptSource).toContain('playerCaptionsTracklistRenderer');
        expect(transcriptSource).not.toContain('/youtubei/v1/player');
        expect(transcriptSource).not.toContain("clientName: 'ANDROID'");
    });
});
