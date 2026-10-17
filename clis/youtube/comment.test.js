import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';

const { mockPrepare, mockReadSapisid } = vi.hoisted(() => ({
  mockPrepare: vi.fn(),
  mockReadSapisid: vi.fn(),
}));

vi.mock('./utils.js', async (importOriginal) => ({
  ...(await importOriginal()),
  prepareYoutubeApiPage: mockPrepare,
  readYoutubeSapisid: mockReadSapisid,
}));

import { getRegistry } from '@jackwener/opencli/registry';
import { findKeyDeep } from './utils.js';
import { buildCommentScript, UNVERIFIED_MARKER } from './comment.js';

const VIDEO_ID = 'dQw4w9WgXcQ';
const TEXT = 'nice video 👍';

describe('youtube comment', () => {
  const command = getRegistry().get('youtube/comment');
  const page = { evaluateOnce: vi.fn() };
  let stderr;

  beforeEach(() => {
    mockPrepare.mockReset().mockResolvedValue(undefined);
    mockReadSapisid.mockReset().mockResolvedValue('sapisid-value');
    page.evaluateOnce.mockReset();
    stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stderr.mockRestore();
  });

  it('registers as a write command with every returned key listed in columns', () => {
    expect(command.access).toBe('write');
    expect(command.columns).toEqual(['status', 'comment_id', 'url', 'message', 'verified']);
  });

  it('refuses to post without --execute and never touches the browser', async () => {
    await expect(command.func(page, { url: VIDEO_ID, text: TEXT })).rejects.toThrow(/--execute/);
    await expect(command.func(page, { url: VIDEO_ID, text: TEXT })).rejects.toBeInstanceOf(ArgumentError);
    expect(mockPrepare).not.toHaveBeenCalled();
    expect(page.evaluateOnce).not.toHaveBeenCalled();
  });

  it('refuses older runtimes before navigation rather than using a retrying evaluator', async () => {
    const evaluate = vi.fn();
    await expect(command.func({ evaluate }, { url: VIDEO_ID, text: TEXT, execute: true }))
      .rejects.toThrow(/evaluateOnce/);
    expect(evaluate).not.toHaveBeenCalled();
    expect(mockPrepare).not.toHaveBeenCalled();
  });

  it('does not retry an unknown write outcome', async () => {
    page.evaluateOnce.mockRejectedValueOnce(Object.assign(new Error('target navigated'), { code: 'target_navigated' }));
    await expect(command.func(page, { url: VIDEO_ID, text: TEXT, execute: true })).rejects.toThrow(/target navigated/);
    expect(page.evaluateOnce).toHaveBeenCalledTimes(1);
  });

  it('rejects an empty comment before any navigation', async () => {
    await expect(command.func(page, { url: VIDEO_ID, text: '   ', execute: true })).rejects.toBeInstanceOf(ArgumentError);
    expect(mockPrepare).not.toHaveBeenCalled();
    expect(page.evaluateOnce).not.toHaveBeenCalled();
  });

  it('rejects targets that do not resolve to an 11-char video id', async () => {
    await expect(command.func(page, { url: 'https://www.youtube.com/@handle', text: TEXT, execute: true }))
      .rejects.toBeInstanceOf(ArgumentError);
    await expect(command.func(page, { url: 'not-a-video-id', text: TEXT, execute: true }))
      .rejects.toBeInstanceOf(ArgumentError);
    expect(mockPrepare).not.toHaveBeenCalled();
  });

  it('accepts a full watch URL and extracts the video id', async () => {
    page.evaluateOnce.mockResolvedValueOnce({ ok: true, commentId: 'Ugx_abc', visible: true, listRead: true });
    const rows = await command.func(page, { url: `https://www.youtube.com/watch?v=${VIDEO_ID}&t=42`, text: TEXT, execute: true });
    expect(rows[0].url).toBe(`https://www.youtube.com/watch?v=${VIDEO_ID}&lc=Ugx_abc`);
    expect(String(page.evaluateOnce.mock.calls[0][0])).toContain(JSON.stringify(VIDEO_ID));
  });

  it('throws AuthRequiredError when the SAPISID cookie is missing', async () => {
    mockReadSapisid.mockResolvedValueOnce(null);
    await expect(command.func(page, { url: VIDEO_ID, text: TEXT, execute: true })).rejects.toBeInstanceOf(AuthRequiredError);
    expect(page.evaluateOnce).not.toHaveBeenCalled();
  });

  it('maps an in-page auth failure to AuthRequiredError', async () => {
    page.evaluateOnce.mockResolvedValueOnce({ error: 'auth', message: 'Not logged in' });
    await expect(command.func(page, { url: VIDEO_ID, text: TEXT, execute: true })).rejects.toBeInstanceOf(AuthRequiredError);
  });

  it('maps HTTP / layout failures to CommandExecutionError with the page message', async () => {
    page.evaluateOnce.mockResolvedValueOnce({ error: 'http', message: 'No comment section found — comments may be disabled' });
    await expect(command.func(page, { url: VIDEO_ID, text: TEXT, execute: true }))
      .rejects.toThrow(/comments may be disabled/);
    page.evaluateOnce.mockResolvedValueOnce({ error: 'config', message: 'YouTube config not found' });
    await expect(command.func(page, { url: VIDEO_ID, text: TEXT, execute: true }))
      .rejects.toBeInstanceOf(CommandExecutionError);
  });

  it('fails typed on a malformed page result instead of inventing a row', async () => {
    page.evaluateOnce.mockResolvedValueOnce({ unexpected: true });
    await expect(command.func(page, { url: VIDEO_ID, text: TEXT, execute: true })).rejects.toBeInstanceOf(CommandExecutionError);
  });

  it('posts exactly once and returns a verified row with the comment permalink', async () => {
    page.evaluateOnce.mockResolvedValueOnce({ ok: true, commentId: 'UgxCommentId123', visible: true, listRead: true });

    const rows = await command.func(page, { url: VIDEO_ID, text: TEXT, execute: true });

    expect(mockPrepare).toHaveBeenCalledTimes(1);
    expect(page.evaluateOnce).toHaveBeenCalledTimes(1);
    const script = String(page.evaluateOnce.mock.calls[0][0]);
    expect(script).toContain("post('next', { videoId })");
    expect(script).toContain("findKeyDeep(section.body, 'createCommentParams')");
    // The read-back is what decides `verified`, so it must be in the script.
    expect(script).toContain('async function listedComments()');
    expect(script).toContain('commentEntityPayload');
    expect(script).toContain("post('comment/create_comment'");
    expect(script).toContain('commentText: ' + JSON.stringify(TEXT));
    expect(script).toContain("'Authorization': authHash");
    expect(rows).toEqual([{
      status: 'success',
      comment_id: 'UgxCommentId123',
      url: `https://www.youtube.com/watch?v=${VIDEO_ID}&lc=UgxCommentId123`,
      message: TEXT,
      verified: true,
    }]);
    expect(stderr).not.toHaveBeenCalled();
  });

  it('reports an accepted write without a comment id as posted-unverified, never as a failure', async () => {
    page.evaluateOnce.mockResolvedValueOnce({ ok: true, commentId: null, visible: false, listRead: false });

    const rows = await command.func(page, { url: VIDEO_ID, text: TEXT, execute: true });

    expect(rows).toEqual([{
      status: 'posted-unverified',
      comment_id: null,
      url: `https://www.youtube.com/watch?v=${VIDEO_ID}`,
      message: TEXT,
      verified: false,
    }]);
    expect(stderr.mock.calls[0][0]).toBe(`${UNVERIFIED_MARKER}\n`);
    expect(stderr.mock.calls[1][0]).toContain(VIDEO_ID);
  });

  it('reports a silently withheld comment as posted-unverified even though an id came back', async () => {
    // Regression, observed 2026-09-13 on video _azfxIliMgI: create_comment
    // answered 200 with a real-looking id, and the comment was never visible.
    // A returned id is not proof of publication; the read-back is.
    page.evaluateOnce.mockResolvedValueOnce({
      ok: true,
      commentId: 'UgxDsuScjOf_N_l8Cu94AaABAg',
      visible: false,
      listRead: true,
    });

    const rows = await command.func(page, { url: VIDEO_ID, text: TEXT, execute: true });

    expect(rows).toEqual([{
      status: 'posted-unverified',
      // The id is still reported so the caller can look it up...
      comment_id: 'UgxDsuScjOf_N_l8Cu94AaABAg',
      // ...but `url` must NOT be an &lc= permalink to a comment nobody can see.
      url: `https://www.youtube.com/watch?v=${VIDEO_ID}`,
      message: TEXT,
      verified: false,
    }]);
    expect(stderr.mock.calls[0][0]).toBe(`${UNVERIFIED_MARKER}\n`);
    expect(stderr.mock.calls[1][0]).toMatch(/not in the video's comment list/);
  });

  it('reports posted-unverified when the comment list could not be read back at all', async () => {
    page.evaluateOnce.mockResolvedValueOnce({ ok: true, commentId: 'UgxUnread', visible: false, listRead: false });

    const rows = await command.func(page, { url: VIDEO_ID, text: TEXT, execute: true });

    expect(rows[0]).toMatchObject({ status: 'posted-unverified', comment_id: 'UgxUnread', verified: false });
    expect(stderr.mock.calls[1][0]).toMatch(/could not be read back/);
  });

  it('unwraps Browser Bridge envelopes before reading the result', async () => {
    page.evaluateOnce.mockResolvedValueOnce({
      session: 'browser:default',
      data: { ok: true, commentId: 'UgxEnvelope', visible: true, listRead: true },
    });
    const rows = await command.func(page, { url: VIDEO_ID, text: TEXT, execute: true });
    expect(rows[0].comment_id).toBe('UgxEnvelope');
    expect(rows[0].verified).toBe(true);
  });
});

describe('youtube comment injected script', () => {
  it('inlines the SAPISID hash and deep-key helpers with JSON-encoded inputs', () => {
    const script = buildCommentScript({ sapisid: 'sapi"sid', videoId: VIDEO_ID, text: 'a "quoted" line\nsecond' });
    expect(script).toContain('async function getSapisidHash');
    expect(script).toContain('function findKeyDeep');
    expect(script).toContain(JSON.stringify('sapi"sid'));
    expect(script).toContain(JSON.stringify('a "quoted" line\nsecond'));
    expect(script).toContain('createCommentParams');
    expect(script).toContain('/youtubei/v1/');
  });
});

describe('findKeyDeep', () => {
  it('finds the first matching leaf key through nested objects and arrays in document order', () => {
    const payload = {
      onResponseReceivedEndpoints: [
        { reloadContinuationItemsCommand: { continuationItems: [
          { commentsHeaderRenderer: { createRenderer: { commentSimpleboxRenderer: { submitButton: { buttonRenderer: {
            serviceEndpoint: { createCommentEndpoint: { createCommentParams: 'PARAMS_1' } },
          } } } } } },
          { other: { createCommentParams: 'PARAMS_2' } },
        ] } },
      ],
    };
    expect(findKeyDeep(payload, 'createCommentParams')).toBe('PARAMS_1');
  });

  it('reads commentId from both the legacy action shape and the entity mutation shape', () => {
    const legacy = { actions: [{ createCommentAction: { contents: { commentThreadRenderer: { comment: { commentRenderer: { commentId: 'Ugx_legacy' } } } } } }] };
    const entity = { frameworkUpdates: { entityBatchUpdate: { mutations: [{ payload: { commentEntityPayload: { properties: { commentId: 'Ugx_entity' } } } }] } } };
    expect(findKeyDeep(legacy, 'commentId')).toBe('Ugx_legacy');
    expect(findKeyDeep(entity, 'commentId')).toBe('Ugx_entity');
  });

  it('returns undefined when the key is absent or the input is not an object', () => {
    expect(findKeyDeep({ a: [{ b: 1 }] }, 'missing')).toBeUndefined();
    expect(findKeyDeep(null, 'x')).toBeUndefined();
    expect(findKeyDeep('string', 'length')).toBeUndefined();
  });
});
