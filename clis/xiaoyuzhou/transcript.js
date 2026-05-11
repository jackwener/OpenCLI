import * as fs from 'node:fs';
import * as path from 'node:path';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CliError } from '@jackwener/opencli/errors';
import { loadXiaoyuzhouCredentials, requestXiaoyuzhouJson, fetchXiaoyuzhouTranscriptBody, extractTranscriptText } from './auth.js';

cli({
    site: 'xiaoyuzhou',
    name: 'transcript',
    access: 'read',
    description: 'Download Xiaoyuzhou transcript as JSON and text (requires local credentials)',
    domain: 'www.xiaoyuzhoufm.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'id', positional: true, required: true, help: 'Episode ID (eid from podcast-episodes output)' },
        { name: 'output', default: './xiaoyuzhou-transcripts', help: 'Output directory' },
        { name: 'json', type: 'boolean', default: true, help: 'Save transcript JSON file' },
        { name: 'text', type: 'boolean', default: true, help: 'Save extracted transcript text file' },
    ],
    columns: ['title', 'podcast', 'status', 'segments', 'json_file', 'text_file'],
    func: async (kwargs) => {
        if (kwargs.json === false && kwargs.text === false) {
            throw new ArgumentError('At least one of --json or --text must be enabled', 'Example: opencli xiaoyuzhou transcript 69dd0c98e2c8be31551f6a33 --text true');
        }
        let credentials = loadXiaoyuzhouCredentials();
        const episodeResponse = await requestXiaoyuzhouJson('/v1/episode/get', {
            query: { eid: kwargs.id },
            credentials,
        });
        credentials = episodeResponse.credentials;
        const episode = episodeResponse.data;
        if (!episode) {
            throw new CliError('NOT_FOUND', 'Episode not found', 'Please check the episode ID');
        }
        const mediaId = String(episode.transcript?.mediaId || episode.media?.id || episode.transcriptMediaId || '').trim();
        if (!mediaId) {
            throw new CliError('PARSE_ERROR', 'mediaId not found in episode payload', 'Transcript metadata requires episode.transcript.mediaId, episode.media.id, or episode.transcriptMediaId');
        }
        const transcriptResponse = await requestXiaoyuzhouJson('/v1/episode-transcript/get', {
            method: 'POST',
            body: {
                eid: kwargs.id,
                mediaId,
            },
            credentials,
        });
        const transcriptMeta = transcriptResponse.data;
        const transcriptUrl = String(transcriptMeta?.transcriptUrl || transcriptMeta?.url || '').trim();
        if (!transcriptUrl) {
            throw new CliError('EMPTY_RESULT', 'Transcript URL not found', 'This episode may not have transcript data available');
        }
        const transcriptBody = await fetchXiaoyuzhouTranscriptBody(transcriptUrl);
        const { text, segmentCount } = extractTranscriptText(transcriptBody);
        if (kwargs.text !== false && transcriptBody.trim() && !text.trim()) {
            throw new CliError('PARSE_ERROR', 'Failed to extract transcript text', 'Transcript payload format is unsupported. Re-run with --json true to inspect the raw payload.');
        }
        const outputDir = path.join(String(kwargs.output || './xiaoyuzhou-transcripts'), String(kwargs.id));
        fs.mkdirSync(outputDir, { recursive: true });
        const jsonPath = path.join(outputDir, 'transcript.json');
        const textPath = path.join(outputDir, 'transcript.txt');
        if (kwargs.json !== false) {
            fs.writeFileSync(jsonPath, transcriptBody, 'utf-8');
        }
        if (kwargs.text !== false) {
            fs.writeFileSync(textPath, text, 'utf-8');
        }
        return [{
                title: episode.title || 'episode',
                podcast: episode.podcast?.title || '-',
                status: 'success',
                segments: kwargs.text === false ? '-' : String(segmentCount),
                json_file: kwargs.json === false ? '-' : jsonPath,
                text_file: kwargs.text === false ? '-' : textPath,
            }];
    },
});
