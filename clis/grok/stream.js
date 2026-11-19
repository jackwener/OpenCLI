/**
 * Grok streaming ask — captures the full SSE response from
 * `POST /rest/app-chat/conversations/new`, surfacing the model's final answer,
 * thinking trace, model id, conversation id, and any generated image URLs.
 *
 * The existing `grok ask` command polls visible message bubbles in the DOM and
 * stabilises on the last assistant turn. That is robust but lossy — the
 * thinking trace, server-assigned conversationId/responseId, model hash, and
 * generated image URLs never reach the agent. `stream` plugs a fetch
 * interceptor in front of grok.com's own client SDK so the entire SSE body
 * lands here verbatim and we hand back a single structured row.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError, TimeoutError } from '@jackwener/opencli/errors';
import {
    authRequired,
    ensureOnGrok,
    isLoggedIn,
    normalizeBooleanFlag,
    sendMessage,
    startNewChat,
} from './utils.js';

const CHAT_ENDPOINT_PATH = '/rest/app-chat/conversations/new';
const SESSION_HINT = 'Likely login/auth/challenge/session issue in the existing grok.com browser session.';

/**
 * Page-side interceptor: patches `window.fetch` once, drains the response body
 * via the stream reader (so SSE chunks are captured even while grok.com is
 * also reading from the original response), and pushes the resulting envelope
 * into `window.__opencliGrokStream`.
 */
const INSTALL_STREAM_INTERCEPTOR_JS = `
(() => {
    if (window.__opencliGrokStreamPatched) return { installed: false };
    window.__opencliGrokStreamPatched = true;
    window.__opencliGrokStream = [];
    const ENDPOINT_HINT = ${JSON.stringify(CHAT_ENDPOINT_PATH)};
    const origFetch = window.fetch.bind(window);
    window.fetch = async function (input, init) {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        const method = (init && init.method)
            || (typeof input !== 'string' && input && input.method)
            || 'GET';
        const response = await origFetch(input, init);
        if (url && url.indexOf(ENDPOINT_HINT) !== -1) {
            const status = response.status;
            (async () => {
                try {
                    const reader = response.clone().body.getReader();
                    const chunks = [];
                    while (true) {
                        const r = await reader.read();
                        if (r.done) break;
                        chunks.push(r.value);
                    }
                    let total = 0;
                    for (const c of chunks) total += c.length;
                    const merged = new Uint8Array(total);
                    let off = 0;
                    for (const c of chunks) { merged.set(c, off); off += c.length; }
                    window.__opencliGrokStream.push({
                        url,
                        method,
                        status,
                        body: new TextDecoder('utf-8').decode(merged),
                        capturedAt: Date.now(),
                    });
                } catch (err) {
                    window.__opencliGrokStream.push({
                        url,
                        method,
                        status,
                        error: err && err.message ? err.message : String(err),
                        capturedAt: Date.now(),
                    });
                }
            })();
        }
        return response;
    };
    return { installed: true };
})()
`;

/**
 * Iterate the newline-delimited JSON frames Grok streams back. Malformed
 * lines are skipped — the upstream stream occasionally interleaves keep-alive
 * blanks and we don't want one bad line to drop the whole response.
 */
export function* iterFrames(rawBody) {
    if (!rawBody) return;
    for (const line of rawBody.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
            yield JSON.parse(trimmed);
        } catch {
            // Skip malformed frame; partial chunks at the seam of the network
            // buffer can leave a half-written JSON tail.
        }
    }
}

/**
 * Reduce the SSE frame sequence into a tabular row: final answer, thinking
 * trace, model id, conversation id, response id, title, and any generated
 * image URLs. The final `modelResponse` frame, when present, wins over the
 * accumulated token stream — Grok occasionally rewrites short answers in the
 * trailing frame.
 */
export function summarizeResponse(rawBody) {
    let conversationId = '';
    let responseId = '';
    let title = '';
    let model = '';
    let thinking = '';
    let final = '';
    const images = [];

    for (const frame of iterFrames(rawBody)) {
        const r = frame && frame.result;
        if (!r) continue;
        if (r.conversation && r.conversation.conversationId) {
            conversationId = r.conversation.conversationId;
        }
        if (r.title && r.title.newTitle) {
            title = r.title.newTitle;
        }
        const resp = r.response;
        if (!resp) continue;
        if (typeof resp.token === 'string') {
            if (resp.isThinking) thinking += resp.token;
            else final += resp.token;
        }
        if (resp.modelResponse) {
            responseId = resp.modelResponse.responseId || responseId;
            model = resp.modelResponse.model || model;
            if (typeof resp.modelResponse.message === 'string' && resp.modelResponse.message) {
                final = resp.modelResponse.message;
            }
            for (const u of resp.modelResponse.generatedImageUrls || []) {
                if (typeof u === 'string') images.push(u);
            }
        }
    }
    return {
        response: final.trim(),
        thinking: thinking.trim(),
        model,
        conversationId,
        responseId,
        title,
        images: images.join('\n'),
    };
}

async function pollForCapture(page, timeoutMs) {
    const POLL_INTERVAL_S = 0.4;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const captures = await page.evaluate(`(window.__opencliGrokStream || []).slice()`);
        if (Array.isArray(captures) && captures.length > 0) return captures[0];
        await page.wait(POLL_INTERVAL_S);
    }
    return null;
}

export const streamCommand = cli({
    site: 'grok',
    name: 'stream',
    access: 'write',
    description: 'Send a message to Grok and capture the full streamed response (final text, thinking, model, conversationId, generated image URLs)',
    domain: 'grok.com',
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    args: [
        { name: 'prompt', positional: true, type: 'string', required: true, help: 'Prompt to send to Grok' },
        { name: 'timeout', type: 'int', default: 180, help: 'Max seconds to wait for the stream to complete (default: 180)' },
        { name: 'new', type: 'boolean', default: false, help: 'Start a new chat before sending (default: false)' },
    ],
    columns: ['response', 'thinking', 'model', 'conversationId', 'responseId', 'title', 'images'],
    func: async (page, kwargs) => {
        const prompt = kwargs.prompt;
        const timeoutSeconds = kwargs.timeout || 180;
        const newChat = normalizeBooleanFlag(kwargs.new);

        if (newChat) {
            await startNewChat(page);
        } else {
            await ensureOnGrok(page);
        }

        if (!(await isLoggedIn(page))) {
            throw authRequired();
        }

        // Install the interceptor BEFORE submitting so it catches the very
        // first chat-endpoint fetch. Idempotent via window guard.
        await page.evaluate(INSTALL_STREAM_INTERCEPTOR_JS);

        const sendResult = await sendMessage(page, prompt);
        if (!sendResult || !sendResult.ok) {
            const reason = sendResult?.reason || 'Unable to send the prompt to Grok.';
            const detail = sendResult?.detail ? ` ${sendResult.detail}` : '';
            throw new CommandExecutionError(`${reason}${detail}`, SESSION_HINT);
        }

        const capture = await pollForCapture(page, timeoutSeconds * 1000);
        if (!capture) {
            throw new TimeoutError('grok stream response', timeoutSeconds);
        }
        if (capture.error) {
            throw new CommandExecutionError(
                `Grok stream capture failed: ${capture.error}`,
                SESSION_HINT,
            );
        }
        if (capture.status >= 400) {
            const preview = (capture.body || '').slice(0, 200);
            throw new CommandExecutionError(
                `Grok responded HTTP ${capture.status}: ${preview}`,
                SESSION_HINT,
            );
        }
        return [summarizeResponse(capture.body || '')];
    },
});

export const __test__ = {
    iterFrames,
    summarizeResponse,
    INSTALL_STREAM_INTERCEPTOR_JS,
};
