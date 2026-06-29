import * as fs from 'node:fs';
import * as path from 'node:path';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { describeTwitterApiError, resolveTwitterOperationMetadata, unwrapBrowserResult } from './shared.js';
import { isRecoverableFileInputError, TWITTER_BEARER_TOKEN } from './utils.js';

const MAX_IMAGES = 4;
const UPLOAD_POLL_MS = 500;
const UPLOAD_TIMEOUT_MS = 30_000;
const COMPOSER_POLL_MS = 250;
const COMPOSER_TIMEOUT_MS = 10_000;
const SUBMIT_POLL_MS = 500;
const SUBMIT_TIMEOUT_MS = 15_000;
const COMPOSE_URL = 'https://x.com/compose/post';
const API_CONTEXT_URL = 'https://x.com/home';
const FILE_INPUT_SELECTOR = 'input[type="file"][data-testid="fileInput"]';
const SUPPORTED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);
// Baked fallback for resolveTwitterOperationMetadata(); runtime lookup still wins
// when twitter-openapi or the loaded X bundle has newer CreateTweet metadata.
const CREATE_TWEET_OPERATION = {
    queryId: '5CdvsV_zjv4L64XFifAglw',
    features: {
        premium_content_api_read_enabled: false,
        communities_web_enable_tweet_community_results_fetch: true,
        c9s_tweet_anatomy_moderator_badge_enabled: true,
        responsive_web_grok_analyze_button_fetch_trends_enabled: false,
        responsive_web_grok_analyze_post_followups_enabled: true,
        rweb_cashtags_composer_attachment_enabled: true,
        responsive_web_jetfuel_frame: true,
        responsive_web_grok_share_attachment_enabled: true,
        responsive_web_grok_annotations_enabled: true,
        responsive_web_edit_tweet_api_enabled: true,
        rweb_conversational_replies_downvote_enabled: false,
        graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
        view_counts_everywhere_api_enabled: true,
        longform_notetweets_consumption_enabled: true,
        responsive_web_twitter_article_tweet_consumption_enabled: true,
        content_disclosure_indicator_enabled: true,
        content_disclosure_ai_generated_indicator_enabled: true,
        responsive_web_grok_show_grok_translated_post: true,
        responsive_web_grok_analysis_button_from_backend: true,
        post_ctas_fetch_enabled: true,
        longform_notetweets_rich_text_read_enabled: true,
        longform_notetweets_inline_media_enabled: false,
        profile_label_improvements_pcf_label_in_post_enabled: true,
        responsive_web_profile_redirect_enabled: false,
        rweb_tipjar_consumption_enabled: false,
        verified_phone_label_enabled: false,
        articles_preview_enabled: true,
        rweb_cashtags_enabled: true,
        responsive_web_grok_community_note_auto_translation_is_enabled: true,
        responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
        freedom_of_speech_not_reach_fetch_enabled: true,
        standardized_nudges_misinfo: true,
        tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
        responsive_web_grok_image_annotation_enabled: true,
        responsive_web_grok_imagine_annotation_enabled: true,
        responsive_web_graphql_timeline_navigation_enabled: true,
    },
    fieldToggles: {},
};

function validateImagePaths(raw) {
    const paths = raw.split(',').map(s => s.trim()).filter(Boolean);
    if (paths.length > MAX_IMAGES) {
        throw new CommandExecutionError(`Too many images: ${paths.length} (max ${MAX_IMAGES})`);
    }
    return paths.map(p => {
        const absPath = path.resolve(p);
        const ext = path.extname(absPath).toLowerCase();
        if (!SUPPORTED_EXTENSIONS.has(ext)) {
            throw new CommandExecutionError(`Unsupported image format "${ext}". Supported: jpg, png, gif, webp`);
        }
        const stat = fs.statSync(absPath, { throwIfNoEntry: false });
        if (!stat || !stat.isFile()) {
            throw new CommandExecutionError(`Not a valid file: ${absPath}`);
        }
        return absPath;
    });
}

function isUnsupportedInsertTextError(err) {
    const msg = err instanceof Error ? err.message : String(err);
    const lower = msg.toLowerCase();
    return lower.includes('unknown action') || lower.includes('not supported') || lower.includes('inserttext returned no inserted flag');
}

async function focusComposer(page) {
    return page.evaluate(`(() => {
        const visible = (el) => !!el && (el.offsetParent !== null || el.getClientRects().length > 0);
        const boxes = Array.from(document.querySelectorAll('[data-testid="tweetTextarea_0"]'));
        const box = boxes.find(visible) || boxes[0];
        if (!box) return { ok: false, message: 'Could not find the tweet composer text area. Are you logged in?' };
        box.focus();
        return { ok: true };
    })()`);
}

async function verifyComposerText(page, text) {
    const iterations = Math.ceil(COMPOSER_TIMEOUT_MS / COMPOSER_POLL_MS);
    return page.evaluate(`(async () => {
        const expected = ${JSON.stringify(text)};
        const normalize = s => String(s || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
        const normalizedExpected = normalize(expected);
        for (let i = 0; i < ${JSON.stringify(iterations)}; i++) {
            const box = document.querySelector('[data-testid="tweetTextarea_0"]');
            const actual = box ? (box.innerText || box.textContent || '') : '';
            if (box && normalize(actual).includes(normalizedExpected)) return { ok: true };
            await new Promise(r => setTimeout(r, ${JSON.stringify(COMPOSER_POLL_MS)}));
        }
        const box = document.querySelector('[data-testid="tweetTextarea_0"]');
        return {
            ok: false,
            message: 'Could not verify tweet text in the composer after typing.',
            actualText: box ? (box.innerText || box.textContent || '') : ''
        };
    })()`);
}

async function insertComposerText(page, text) {
    const focusResult = await focusComposer(page);
    if (!focusResult?.ok) return focusResult;

    const nativeInserters = [
        page.nativeType?.bind(page),
        page.insertText?.bind(page),
    ].filter(Boolean);

    for (const insert of nativeInserters) {
        try {
            // Native CDP Input.insertText updates Twitter/X's Draft.js editor much more
            // reliably than synthetic paste/input events. Prefer the Page CDP helper
            // when available because older Browser Bridge insert-text can report
            // inserted while the editor state does not change after media upload.
            await insert(text);
            const verified = await verifyComposerText(page, text);
            if (verified?.ok) return verified;
        }
        catch (err) {
            if (!isUnsupportedInsertTextError(err)) throw err;
            // Older Browser Bridge versions do not expose this insertion path; try the next one.
        }
    }

    return page.evaluate(`(async () => {
        try {
            const visible = (el) => !!el && (el.offsetParent !== null || el.getClientRects().length > 0);
            const boxes = Array.from(document.querySelectorAll('[data-testid="tweetTextarea_0"]'));
            const box = boxes.find(visible) || boxes[0];
            if (!box) return { ok: false, message: 'Could not find the tweet composer text area. Are you logged in?' };
            const textToInsert = ${JSON.stringify(text)};
            const normalize = s => String(s || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
            box.focus();
            if (!document.execCommand('insertText', false, textToInsert)) {
                const dt = new DataTransfer();
                dt.setData('text/plain', textToInsert);
                box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
            }
            await new Promise(r => setTimeout(r, 500));
            const actual = box.innerText || box.textContent || '';
            if (normalize(actual).includes(normalize(textToInsert))) return { ok: true };
            return { ok: false, message: 'Could not verify tweet text in the composer after typing.', actualText: actual };
        } catch (e) { return { ok: false, message: String(e) }; }
    })()`);
}

async function waitForImageUpload(page, expectedCount) {
    const iterations = Math.ceil(UPLOAD_TIMEOUT_MS / UPLOAD_POLL_MS);
    return page.evaluate(`(async () => {
        const expected = ${JSON.stringify(expectedCount)};
        const visible = (el) => !!el && (el.offsetParent !== null || el.getClientRects().length > 0);
        for (let i = 0; i < ${JSON.stringify(iterations)}; i++) {
            await new Promise(r => setTimeout(r, ${JSON.stringify(UPLOAD_POLL_MS)}));
            const attachments = document.querySelector('[data-testid="attachments"]');
            const previewCount = Math.max(
                attachments ? attachments.querySelectorAll('[role="group"], img, video').length : 0,
                document.querySelectorAll('[data-testid="tweetPhoto"], img[src^="blob:"], video[src^="blob:"]').length,
                Array.from(document.querySelectorAll('button,[role="button"]')).filter((el) =>
                    /remove media|remove image|remove/i.test((el.getAttribute('aria-label') || '') + ' ' + (el.textContent || ''))
                ).length
            );
            const button = Array.from(document.querySelectorAll('[data-testid="tweetButtonInline"], [data-testid="tweetButton"]'))
                .find((el) => visible(el));
            const buttonReady = !!button && !button.disabled && button.getAttribute('aria-disabled') !== 'true';
            if (previewCount >= expected && buttonReady) return { ok: true, previewCount };
        }
        return { ok: false, message: 'Image upload timed out (${UPLOAD_TIMEOUT_MS / 1000}s).' };
    })()`);
}

async function attachImagesViaDataTransfer(page, absPaths) {
    const files = absPaths.map((absPath) => {
        const ext = path.extname(absPath).toLowerCase();
        const mime = ext === '.png'
            ? 'image/png'
            : ext === '.gif'
                ? 'image/gif'
                : ext === '.webp'
                    ? 'image/webp'
                    : 'image/jpeg';
        return {
            name: path.basename(absPath),
            mime,
            base64: fs.readFileSync(absPath).toString('base64'),
        };
    });
    const upload = await page.evaluate(`(() => {
        const input = document.querySelector(${JSON.stringify(FILE_INPUT_SELECTOR)});
        if (!input) return { ok: false, error: 'No file input found' };
        const dt = new DataTransfer();
        for (const file of ${JSON.stringify(files)}) {
            const bin = atob(file.base64);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            dt.items.add(new File([bytes], file.name, { type: file.mime }));
        }
        let assigned = false;
        try {
            Object.defineProperty(input, 'files', { value: dt.files, writable: false, configurable: true });
            assigned = input.files && input.files.length >= ${JSON.stringify(absPaths.length)};
        } catch(e) {
            try {
                const nativeInputFileSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'files');
                if (nativeInputFileSetter && nativeInputFileSetter.set) {
                    nativeInputFileSetter.set.call(input, dt.files);
                    assigned = input.files && input.files.length >= ${JSON.stringify(absPaths.length)};
                }
            } catch(e2) { /* ignore */ }
        }
        if (!assigned) return { ok: false, error: 'Could not assign files to input' };
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return { ok: true };
    })()`);
    if (!upload?.ok) {
        throw new CommandExecutionError(`Image upload failed (base64 fallback): ${upload?.error ?? 'unknown error'}`);
    }
}

async function submitTweet(page, text) {
    const clickResult = await page.evaluate(`(async () => {
        try {
            const visible = (el) => !!el && (el.offsetParent !== null || el.getClientRects().length > 0);
            const buttons = Array.from(document.querySelectorAll('[data-testid="tweetButtonInline"], [data-testid="tweetButton"]'));
            const btn = buttons.find((el) => visible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true');
            if (!btn) return { ok: false, message: 'Tweet button is disabled or not found.' };
            btn.click();
            return { ok: true };
        } catch (e) { return { ok: false, message: String(e) }; }
    })()`);
    if (!clickResult?.ok) return clickResult;

    const iterations = Math.ceil(SUBMIT_TIMEOUT_MS / SUBMIT_POLL_MS);
    return page.evaluate(`(async () => {
        const expected = ${JSON.stringify(text)};
        const normalize = s => String(s || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
        const expectedText = normalize(expected);
        const visible = (el) => !!el && (el.offsetParent !== null || el.getClientRects().length > 0);
        const statusUrl = (root = document) => {
            const links = Array.from(root.querySelectorAll('a[href*="/status/"]'));
            for (const link of links) {
                const href = link.href || link.getAttribute('href') || '';
                if (!href) continue;
                try {
                    const url = new URL(href, window.location.origin);
                    const match = url.pathname.match(/^\\/(?:[^/]+|i)\\/status\\/(\\d+)/);
                    if (match) return { url: url.href, id: match[1] };
                } catch {}
            }
            return {};
        };
        for (let i = 0; i < ${JSON.stringify(iterations)}; i++) {
            await new Promise(r => setTimeout(r, ${JSON.stringify(SUBMIT_POLL_MS)}));
            const toasts = Array.from(document.querySelectorAll('[role="alert"], [data-testid="toast"]'))
                .filter((el) => visible(el));
            const successToast = toasts.find((el) => /sent|posted|your post was sent|your tweet was sent/i.test(el.textContent || ''));
            if (successToast) return { ok: true, message: 'Tweet posted successfully.', ...statusUrl(successToast) };
            const alert = toasts.find((el) => /failed|error|try again|not sent|could not/i.test(el.textContent || ''));
            if (alert) return { ok: false, message: (alert.textContent || 'Tweet failed to post.').trim() };

            const boxes = Array.from(document.querySelectorAll('[data-testid="tweetTextarea_0"]')).filter(visible);
            const composerStillHasText = boxes.some((box) => normalize(box.innerText || box.textContent || '').includes(expectedText));
            // Drop the global tweetPhoto query: tweetPhoto exists for every
            // timeline tweet's image and would pin hasMedia true past the
            // success path. attachments + blob: URLs are composer-only.
            const hasMedia = !!document.querySelector('[data-testid="attachments"]')
                || document.querySelectorAll('img[src^="blob:"], video[src^="blob:"]').length > 0;
            if (!composerStillHasText && !hasMedia) {
                return { ok: true, message: 'Tweet posted successfully.', ...statusUrl() };
            }
        }
        return { ok: false, message: 'Tweet submission did not complete before timeout.' };
    })()`);
}

function formatGraphqlErrors(bodyJson) {
    const errors = Array.isArray(bodyJson?.errors) ? bodyJson.errors : [];
    if (errors.length === 0) return '';
    return errors
        .map((error) => error?.message || JSON.stringify(error))
        .filter(Boolean)
        .join('; ')
        .slice(0, 300);
}

function extractCreatedTweet(bodyJson) {
    const result = bodyJson?.data?.create_tweet?.tweet_results?.result;
    const tweet = result?.tweet || result;
    if (!tweet || typeof tweet !== 'object') return null;
    const id = String(tweet.rest_id || tweet.legacy?.id_str || '').trim();
    if (!/^\d+$/.test(id)) return null;
    const user = tweet.core?.user_results?.result;
    const screenName = String(user?.core?.screen_name || user?.legacy?.screen_name || '').trim();
    return {
        id,
        url: screenName ? `https://x.com/${screenName}/status/${id}` : `https://x.com/i/status/${id}`,
    };
}

async function postTextViaCreateTweet(page, text) {
    await page.goto(API_CONTEXT_URL, { waitUntil: 'load', settleMs: 1000 });
    const cookies = await page.getCookies({ url: 'https://x.com' });
    const ct0 = cookies.find((c) => c.name === 'ct0')?.value || null;
    if (!ct0) throw new AuthRequiredError('x.com', 'Not logged into x.com (no ct0 cookie)');

    const operation = await resolveTwitterOperationMetadata(page, 'CreateTweet', CREATE_TWEET_OPERATION);
    const payload = {
        variables: {
            tweet_text: text,
            dark_request: false,
            media: { media_entities: [], possibly_sensitive: false },
            semantic_annotation_ids: [],
        },
        features: operation.features,
        queryId: operation.queryId,
    };
    if (operation.fieldToggles && Object.keys(operation.fieldToggles).length > 0) {
        payload.fieldToggles = operation.fieldToggles;
    }

    const headers = JSON.stringify({
        'Authorization': `Bearer ${decodeURIComponent(TWITTER_BEARER_TOKEN)}`,
        'X-Csrf-Token': ct0,
        'X-Twitter-Auth-Type': 'OAuth2Session',
        'X-Twitter-Active-User': 'yes',
        'Content-Type': 'application/json',
    });
    const apiUrl = `/i/api/graphql/${operation.queryId}/CreateTweet`;
    const body = JSON.stringify(payload);
    const result = unwrapBrowserResult(await page.evaluate(`async () => {
        const r = await fetch(${JSON.stringify(apiUrl)}, {
            method: 'POST',
            headers: ${headers},
            credentials: 'include',
            body: ${JSON.stringify(body)},
        });
        const bodyText = await r.text();
        let bodyJson = null;
        try { bodyJson = JSON.parse(bodyText); } catch {}
        return { ok: r.ok, httpStatus: r.status, bodyJson, bodyText };
    }`));

    if (result?.httpStatus === 401 || result?.httpStatus === 403) {
        throw new AuthRequiredError('x.com', `Twitter CreateTweet returned HTTP ${result.httpStatus}`);
    }
    if (!result?.ok) {
        const hint = formatGraphqlErrors(result?.bodyJson);
        const message = describeTwitterApiError('CreateTweet', result?.httpStatus ?? 0, hint || undefined);
        return { ok: false, message };
    }

    const created = extractCreatedTweet(result.bodyJson);
    if (!created) {
        const error = formatGraphqlErrors(result.bodyJson);
        return {
            ok: false,
            message: error ? `CreateTweet failed: ${error}` : 'CreateTweet returned no created tweet id.',
        };
    }

    return { ok: true, message: 'Tweet posted successfully.', ...created };
}

cli({
    site: 'twitter',
    name: 'post',
    access: 'write',
    description: 'Post a new tweet/thread',
    domain: 'x.com',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'text', type: 'string', required: true, positional: true, help: 'The text content of the tweet' },
        { name: 'images', type: 'string', required: false, help: 'Image paths, comma-separated, max 4 (jpg/png/gif/webp)' },
    ],
    columns: ['status', 'message', 'text', 'id', 'url'],
    func: async (page, kwargs) => {
        if (!page)
            throw new CommandExecutionError('Browser session required for twitter post');

        // Validate images upfront before any browser interaction.
        const absPaths = kwargs.images ? validateImagePaths(String(kwargs.images)) : [];
        const text = String(kwargs.text ?? '');

        try {
            // The current X standalone composer is /compose/post. It keeps a single,
            // visible composer and is the same route used by the reply command.
            await page.goto(COMPOSE_URL, { waitUntil: 'load', settleMs: 2500 });
            await page.wait({ selector: '[data-testid="tweetTextarea_0"]', timeout: 15 });
        } catch (err) {
            if (absPaths.length > 0) throw err;
            // This runs before any text insertion or submit click, so the API
            // fallback cannot duplicate a post. Media posts still need the UI
            // composer because this path does not upload media entities.
            const result = await postTextViaCreateTweet(page, text);
            return [{
                status: result?.ok ? 'success' : 'failed',
                message: result?.message ?? 'Tweet failed to post.',
                text,
                ...(result?.id ? { id: result.id } : {}),
                ...(result?.url ? { url: result.url } : {}),
            }];
        }

        // Attach media before inserting text. Uploading media after Draft.js has
        // text can re-render/reset the editor, causing image-only posts.
        if (absPaths.length > 0) {
            await page.wait({ selector: FILE_INPUT_SELECTOR, timeout: 20 });
            if (page.setFileInput) {
                try {
                    await page.setFileInput(absPaths, FILE_INPUT_SELECTOR);
                } catch (err) {
                    if (!isRecoverableFileInputError(err)) {
                        throw err;
                    }
                    await attachImagesViaDataTransfer(page, absPaths);
                }
            } else {
                await attachImagesViaDataTransfer(page, absPaths);
            }
            const uploadState = await waitForImageUpload(page, absPaths.length);
            if (!uploadState?.ok) {
                return [{ status: 'failed', message: uploadState?.message ?? `Image upload timed out (${UPLOAD_TIMEOUT_MS / 1000}s).`, text }];
            }
        }

        // Insert and verify the text after media upload so text + images are in
        // the final Draft.js composer state immediately before clicking Post.
        const typeResult = await insertComposerText(page, text);
        if (!typeResult?.ok) {
            return [{ status: 'failed', message: typeResult?.message ?? 'Could not type tweet text.', text }];
        }

        await page.wait(1);
        const result = await submitTweet(page, text);
        return [{
            status: result?.ok ? 'success' : 'failed',
            message: result?.message ?? 'Tweet failed to post.',
            text,
            ...(result?.id ? { id: result.id } : {}),
            ...(result?.url ? { url: result.url } : {}),
        }];
    }
});
