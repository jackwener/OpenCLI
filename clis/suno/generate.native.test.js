import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';

const mocks = vi.hoisted(() => ({ session: vi.fn(), captcha: vi.fn(), submit: vi.fn(), poll: vi.fn(), download: vi.fn() }));
vi.mock('./utils.js', async importOriginal => ({
    ...await importOriginal(),
    ensureSunoSession: mocks.session,
    checkSunoCaptcha: mocks.captcha,
    submitSunoGeneration: mocks.submit,
    pollSunoClips: mocks.poll,
    downloadSunoClip: mocks.download,
}));
const { generateCommand, prepareSunoNative } = await import('./generate.js');
const ids = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'];
const description = 'Spacious instrumental piano and cello, 60 BPM.';
const options = { prompt: description, instrumental: true, title: 'Test score', sd: true, timeout: 2 };
const payload = { mode: 'simple', model: 'chirp-hawk', modelName: 'v6', weirdness: 0.5, styleWeight: 0.5, description, lyrics: '', tags: '', negativeTags: '', makeInstrumental: true, deviceId: 'device-test' };
const clips = () => ids.map(id => ({ id, title: 'Native title', status: 'complete', model_name: 'chirp-hawk', metadata: { tags: description, prompt: '', negative_tags: '', make_instrumental: true } }));
const nativeRequest = { generation_type: 'TEXT', mv: 'chirp-hawk', prompt: '', tags: description, negative_tags: '', make_instrumental: true,
    metadata: { create_mode: 'custom', control_sliders: { aug_creativity: 4 } },
    cover_clip_id: null, continue_clip_id: null, artist_clip_id: null, persona_id: null, user_uploaded_images_b64: null };

// Browser-shaped fixture executes the production DOM reads, form preparation,
// click/capture orchestration and title persistence, without a paid request.
function browser({ model = 'v6', capture = true, body, request, entry = {}, challenge = false, noRows = false, clickError = false, saveTitle = true, saveServerTitle = true, covered = false, emptyForm = false, replayCreate = false, storageUnavailable = false, delayedCapture = false, delayedRequestCapture = false, lateRequestCapture = false } = {}) {
    const dom = new JSDOM(`<button role="tab" aria-label="Simple" aria-selected="false"></button>
      <button role="tab" aria-label="Advanced" aria-selected="false"></button>
      <textarea rows="1">previous prompt</textarea>
      <div aria-label="Lyrics editor" contenteditable="true" role="textbox"></div>
      <div data-testid="create-form-styles-wrapper"><textarea>previous style</textarea></div>
      <input placeholder="Exclude styles" value="previous exclusion">
      <div role="slider" aria-label="Weirdness" aria-valuenow="50" tabindex="0"></div>
      <div role="slider" aria-label="Style Influence" aria-valuenow="50" tabindex="0"></div>
      <button aria-label="Clear all form inputs"></button>
      <button aria-haspopup="menu">${model}</button><button aria-haspopup="menu" hidden>v6-mini</button>
      <div id="model-menu" hidden><div role="menuitemradio">v6</div><div role="menuitemradio">v6-wild</div><div role="menuitemradio" hidden>v6-wild</div><div role="menuitemradio">v6-mini</div></div>
      <button aria-label="Create song"></button><main></main>`, { runScripts: 'outside-only', url: 'https://suno.com/create' });
    const w = dom.window;
    if (storageUnavailable) Object.defineProperty(w, 'sessionStorage', { get() { throw new Error('storage blocked'); } });
    if (emptyForm) {
        w.document.querySelector('textarea').value = '';
        w.document.querySelector('[data-testid="create-form-styles-wrapper"] textarea').value = '';
        w.document.querySelector('input[placeholder="Exclude styles"]').value = '';
        w.document.querySelector('button[aria-label="Clear all form inputs"]').disabled = true;
    }
    Object.defineProperty(w.HTMLElement.prototype, 'innerText', { get() { return this.textContent; } });
    w.Element.prototype.getClientRects = function () { return this.hidden ? [] : [{}]; };
    w.Element.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 80 });
    w.Element.prototype.scrollIntoView = () => {};
    w.document.elementFromPoint = () => covered ? w.document.body : w.document.querySelector('button[aria-label="Create song"]');
    let submitted = false;
    let captureReads = 0;
    let editing;
    const page = {
        dom,
        backendTitles: new Map(ids.map(id => [id, 'Native title'])),
        goto: vi.fn(),
        screenshot: vi.fn(async () => ''),
        wait: vi.fn(async value => { if (typeof value === 'number') vi.advanceTimersByTime(value * 1000); }),
        evaluate: vi.fn(async js => {
            if (js.includes('/api/feed/v2?page=0')) return { ok: true, ids: [] };
            const value = w.eval(js);
            const isDispatch = js.includes('opencli:suno:create:');
            if (isDispatch && clickError && value?.status === 'dispatched') throw Object.assign(new Error('lost execution result after click'), { code: 'command_result_unknown' });
            // Simulate the production Page.evaluate target-navigation retry:
            // the exact same expression executes again after its first write.
            if (isDispatch && replayCreate) return w.eval(js);
            return value;
        }),
        startNetworkCapture: vi.fn(async () => capture),
        readNetworkCapture: vi.fn(async () => {
            if (!submitted) return [];
            captureReads++;
            return [{
                url: 'https://studio-api-prod.suno.com/api/generate/v2-web/', method: 'POST', requestId: 'request-1', responseStatus: 200,
                timestamp: 1,
                requestBodyKind: 'string',
                requestBodyPreview: (delayedRequestCapture && captureReads === 1) || (lateRequestCapture && captureReads <= 2)
                    ? '' : JSON.stringify(request || nativeRequest),
                responsePreview: delayedCapture && captureReads === 1 ? undefined : JSON.stringify(body || { clips: clips() }),
                captureComplete: lateRequestCapture ? (captureReads > 2 ? true : undefined) :
                    !(delayedCapture || delayedRequestCapture) || captureReads > 1,
                ...entry,
            }];
        }),
        fillText: vi.fn(async (selector, value) => {
            const targets = w.document.querySelectorAll(selector);
            if (targets.length !== 1) throw new Error('ambiguous fill');
            if (targets[0].hasAttribute('contenteditable')) targets[0].textContent = value;
            else targets[0].value = value;
            return { verified: (targets[0].hasAttribute('contenteditable') ? targets[0].textContent : targets[0].value) === value };
        }),
        click: vi.fn(async selector => {
            const target = w.document.querySelector(selector);
            if (!target) throw new Error('native tab click target missing');
            target.click();
            return { clicked: true };
        }),
        nativeClick: vi.fn(async () => { throw new Error('no native click fallback'); }),
        controls: vi.fn(),
        dispatched: vi.fn(),
    };
    w.document.addEventListener('click', event => {
        const option = event.target.closest('[role="menuitemradio"]');
        if (option) {
            w.document.querySelector('button[aria-haspopup="menu"]').textContent = option.textContent;
            w.document.querySelector('#model-menu').hidden = true;
            return;
        }
        const target = event.target.closest('button');
        if (!target) return;
        const label = target.getAttribute('aria-label') || target.textContent;
        page.controls(label);
        if (target.matches('button[aria-haspopup="menu"]')) w.document.querySelector('#model-menu').hidden = false;
        else if (label === 'Simple' || label === 'Advanced') {
            w.document.querySelectorAll('[role="tab"]').forEach(tab => tab.setAttribute('aria-selected', String(tab === target)));
        }
        else if (label === 'Clear all form inputs') {
            w.document.body.insertAdjacentHTML('beforeend', '<div role="alertdialog"><h2>Clear entire form?</h2><button class="hxc-btn-variant-primary">Confirm</button><button>Cancel</button></div>');
        } else if (label === 'Confirm') {
            w.document.querySelector('textarea').value = '';
            w.document.querySelector('[aria-label="Lyrics editor"]').textContent = '';
            w.document.querySelector('[data-testid="create-form-styles-wrapper"] textarea').value = '';
            w.document.querySelector('input[placeholder="Exclude styles"]').value = '';
            w.document.querySelector('[role="alertdialog"]').remove();
        } else if (label === 'Create song') {
            page.dispatched();
            submitted = true;
            if (!noRows) w.document.querySelector('main').innerHTML = ids.map(id => `<div data-testid="clip-row"><a href="/song/${id}">Native title</a><button aria-label="Edit title"></button></div>`).join('');
            if (challenge) {
                const frame = w.document.createElement('iframe');
                frame.src = 'https://challenges.cloudflare.com/visible-challenge';
                w.document.body.append(frame);
            }
        } else if (label === 'Edit title') {
            const row = target.parentElement;
            editing = { row, href: row.querySelector('a').getAttribute('href') };
            row.querySelector('a').remove();
            row.insertAdjacentHTML('afterbegin', '<input maxlength="80">');
        }
    });
    w.document.addEventListener('keydown', event => {
        if (event.key === 'Enter' && saveTitle && editing) {
            const value = editing.row.querySelector('input').value;
            editing.row.querySelector('input').remove();
            const a = w.document.createElement('a'); a.href = editing.href; a.textContent = value;
            editing.row.prepend(a);
            if (saveServerTitle) page.backendTitles.set(editing.href.split('/').pop(), value);
        }
    });
    return page;
}
const createClicks = page => page.dispatched.mock.calls;

beforeEach(() => {
    vi.useFakeTimers();
    mocks.session.mockReset().mockResolvedValue({ planId: 'plan-test', deviceId: 'device-test', totalCreditsAvailable: 20, breakdown: {},
        models: [{ name: 'v6', externalKey: 'chirp-hawk', canUse: true, isDefault: true },
            { name: 'v6-wild', externalKey: 'chirp-hawk-wild', canUse: true, isDefault: false },
            { name: 'v6-mini', externalKey: 'chirp-goose', canUse: true, isDefault: false }] });
    mocks.captcha.mockReset().mockResolvedValue({ ok: true, required: true });
    mocks.submit.mockReset();
    mocks.poll.mockReset().mockImplementation(async page => clips().map(c => ({ ...c, title: page.backendTitles.get(c.id) })));
    mocks.download.mockReset().mockResolvedValue({ written: [{ ok: true, format: 'metadata', file: '/tmp/test.json' }] });
});
afterEach(() => vi.useRealTimers());

describe('Suno native Create fallback', () => {
    it('waits for a delayed capture body without a second Create click', async () => {
        const page = browser({ delayedCapture: true });
        const rows = await generateCommand.func(page, options);
        expect(rows).toHaveLength(2);
        expect(createClicks(page)).toHaveLength(1);
        expect(page.readNetworkCapture).toHaveBeenCalledTimes(4);
    });
    it('waits for a delayed request body even after the response body arrives', async () => {
        const page = browser({ delayedRequestCapture: true });
        const rows = await generateCommand.func(page, options);
        expect(rows).toHaveLength(2);
        expect(createClicks(page)).toHaveLength(1);
        expect(page.readNetworkCapture).toHaveBeenCalledTimes(4);
    });
    it('does not treat a new-extension response as complete before its request body arrives', async () => {
        const page = browser({ lateRequestCapture: true });
        const rows = await generateCommand.func(page, options);
        expect(rows).toHaveLength(2);
        expect(createClicks(page)).toHaveLength(1);
        expect(page.readNetworkCapture).toHaveBeenCalledTimes(5);
    });
    it.each(['stable IDs', 'legacy captures'])('detects two POSTs with the same timestamp: %s', async kind => {
        const page = browser();
        const read = page.readNetworkCapture.bind(page);
        page.readNetworkCapture = vi.fn(async () => {
            const entries = await read();
            if (!entries.length) return entries;
            const first = { ...entries[0], timestamp: 42 };
            const second = { ...entries[0], timestamp: 42, requestId: 'request-2' };
            if (kind === 'legacy captures') {
                delete first.requestId;
                delete second.requestId;
            }
            return [first, second];
        });
        await expect(generateCommand.func(page, options)).rejects.toThrow('expected one generation response');
        expect(createClicks(page)).toHaveLength(1);
    });
    it('selects v6-wild from the live model menu before one submission', async () => {
        const page = browser({ request: { ...nativeRequest, mv: 'chirp-hawk-wild' },
            body: { clips: ids.map(id => ({ id, model_name: 'chirp-hawk', metadata: { tags: 'upsampled', prompt: '', make_instrumental: true } })) } });
        const rows = await generateCommand.func(page, { ...options, model: 'v6-wild' });
        expect(rows).toHaveLength(2);
        expect(page.dom.window.document.querySelector('button[aria-haspopup="menu"]').textContent).toBe('v6-wild');
        expect(createClicks(page)).toHaveLength(1);
    });
    it('prepares Advanced lyrics, styles, and exclusions before Custom generation', async () => {
        const lyrics = '[Verse] Adapter proof';
        const tags = 'sparse piano';
        const negative = 'drums';
        const page = browser({ request: { ...nativeRequest, prompt: lyrics, tags, negative_tags: negative, make_instrumental: false },
            body: { clips: ids.map(id => ({ id, model_name: 'chirp-hawk', metadata: { tags, prompt: lyrics, negative_tags: negative, make_instrumental: false } })) } });
        const rows = await generateCommand.func(page, { lyrics, tags, 'negative-tags': negative, title: 'Test score', sd: true, timeout: 2 });
        expect(rows).toHaveLength(2);
        expect(page.dom.window.document.querySelector('[aria-label="Lyrics editor"]').textContent).toBe(lyrics);
        expect(page.dom.window.document.querySelector('[data-testid="create-form-styles-wrapper"] textarea').value).toBe(tags);
        expect(createClicks(page)).toHaveLength(1);
    });
    it('uses the current Simple textarea for a vocal Simple prompt', async () => {
        const page = browser({ request: { ...nativeRequest, prompt: '', gpt_description_prompt: description, tags: '', make_instrumental: false,
            metadata: { create_mode: 'simple', control_sliders: { aug_creativity: 4 } } },
            body: { clips: ids.map(id => ({ id, model_name: 'chirp-hawk', metadata: { gpt_description_prompt: description, make_instrumental: false } })) } });
        const rows = await generateCommand.func(page, { ...options, instrumental: false });
        expect(rows).toHaveLength(2);
        expect(page.dom.window.document.querySelector('textarea[rows="1"]').value).toBe(description);
        expect(createClicks(page)).toHaveLength(1);
    });
    it('uses the same native path with --via-ui when verification is not required', async () => {
        mocks.captcha.mockResolvedValue({ ok: true, required: false });
        const page = browser();
        const rows = await generateCommand.func(page, { ...options, 'via-ui': true });
        expect(rows).toHaveLength(2);
        expect(createClicks(page)).toHaveLength(1);
        expect(mocks.submit).not.toHaveBeenCalled();
        expect(mocks.poll).toHaveBeenCalledTimes(2);
    });
    it('runs the production required=true path, binds results, saves titles, and never POSTs via the old API', async () => {
        const page = browser();
        const rows = await generateCommand.func(page, options);
        expect(createClicks(page)).toHaveLength(1);
        expect(mocks.submit).not.toHaveBeenCalled();
        expect(mocks.poll.mock.calls[0][0]).toBe(page);
        expect(mocks.poll.mock.calls[0].slice(1)).toEqual([ids, 2, 'device-test']);
        expect(rows.map(row => row.title)).toEqual(['Test score', 'Test score']);
        expect(rows.map(row => row.link)).toEqual(ids.map(id => `🔗 https://suno.com/song/${id}`));
        expect(page.readNetworkCapture.mock.invocationCallOrder[0]).toBeLessThan(page.dispatched.mock.invocationCallOrder[0]);
        expect(mocks.poll).toHaveBeenCalledTimes(2);
    });
    it('continues into the existing download path for the same clip ids', async () => {
        const page = browser();
        await generateCommand.func(page, { ...options, sd: false, formats: 'metadata' });
        expect(mocks.download).toHaveBeenCalledTimes(2);
        expect(mocks.download.mock.calls.map(([, clip]) => clip.id)).toEqual(ids);
        expect(createClicks(page)).toHaveLength(1);
    });
    it('skips the disabled clear button on an already empty form', async () => {
        const page = browser({ emptyForm: true });
        const rows = await generateCommand.func(page, options);
        expect(rows).toHaveLength(2);
        expect(page.controls.mock.calls.some(([s]) => s.includes('Clear all'))).toBe(false);
        expect(createClicks(page)).toHaveLength(1);
    });
    it.each([{ mode: 'custom', lyrics: 'x', makeInstrumental: true }, { description: 'x'.repeat(1001) }, { negativeTags: 'x'.repeat(1001) }])('rejects unsupported native input before navigation: %j', async changed => {
        const page = browser();
        await expect(prepareSunoNative(page, { ...payload, ...changed })).rejects.toMatchObject({ code: 'ARGUMENT' });
        expect(page.goto).not.toHaveBeenCalled();
    });
    it('corrects a stale model choice before a paid click', async () => {
        const page = browser({ model: 'v4' });
        const rows = await generateCommand.func(page, options);
        expect(rows).toHaveLength(2);
        expect(page.dom.window.document.querySelector('button[aria-haspopup="menu"]').textContent).toBe('v6');
        expect(createClicks(page)).toHaveLength(1);
    });
    it('refuses when capture cannot be armed', async () => {
        const page = browser({ capture: false });
        await expect(generateCommand.func(page, options)).rejects.toThrow('no generation was submitted');
        expect(createClicks(page)).toHaveLength(0);
    });
    it('never clicks through an overlay covering Create', async () => {
        const page = browser({ covered: true });
        await expect(generateCommand.func(page, options)).rejects.toThrow('covered');
        expect(createClicks(page)).toHaveLength(0);
    });
    it.each([
        { clips: clips().map((c, i) => i === 0 ? { ...c, id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' } : c) },
        { clips: [clips()[0], clips()[0]] },
        { clips: [] },
    ])('rejects mismatched or malformed successful responses without retry: %j', async body => {
        const page = browser({ body });
        await expect(generateCommand.func(page, options)).rejects.toThrow('did not match');
        expect(createClicks(page)).toHaveLength(1);
        expect(mocks.submit).not.toHaveBeenCalled();
        expect(mocks.poll).not.toHaveBeenCalled();
    });
    it('rejects a captured request for the wrong model without retry', async () => {
        const page = browser({ request: { ...nativeRequest, mv: 'chirp-goose' } });
        await expect(generateCommand.func(page, options)).rejects.toThrow('did not match this invocation');
        expect(createClicks(page)).toHaveLength(1);
        expect(mocks.poll).not.toHaveBeenCalled();
    });
    it.each([
        { generation_type: 'COVER' },
        { persona_id: 'another-persona' },
        { metadata: { create_mode: 'simple', control_sliders: { weirdness_constraint: 0.99 } } },
    ])('rejects a captured request with unexpected creation controls: %j', async changed => {
        const page = browser({ request: { ...nativeRequest, ...changed } });
        await expect(generateCommand.func(page, options)).rejects.toThrow('did not match this invocation');
        expect(createClicks(page)).toHaveLength(1);
        expect(mocks.poll).not.toHaveBeenCalled();
    });
    it.each([{ challenge: true }, { clickError: true }, { noRows: true }])('never retries after an uncertain native write: %j', async behavior => {
        const page = browser(behavior);
        await expect(generateCommand.func(page, options)).rejects.toThrow(/Do not rerun generate/);
        expect(createClicks(page)).toHaveLength(1);
        expect(mocks.submit).not.toHaveBeenCalled();
    });
    it.each([{ responseStatus: 403 }, { responseBodyTruncated: true }, { responsePreview: undefined }, { responsePreview: '<html>not JSON</html>' }, { requestBodyTruncated: true }])('fails closed on unsuccessful or incomplete captures: %j', async entry => {
        const page = browser({ entry });
        await expect(generateCommand.func(page, options)).rejects.toThrow(/Do not rerun generate/);
        expect(createClicks(page)).toHaveLength(1);
        expect(mocks.submit).not.toHaveBeenCalled();
    });
    it('preserves submitted ids when later polling fails', async () => {
        const original = Object.assign(new Error('poll timeout'), { code: 'command_result_unknown' });
        mocks.poll.mockRejectedValue(original);
        const page = browser();
        const error = await generateCommand.func(page, options).catch(e => e);
        expect(error.message).toContain(`Suno submitted ${ids.join(', ')}`);
        expect(error.cause).toBe(original);
        expect(createClicks(page)).toHaveLength(1);
        expect(mocks.submit).not.toHaveBeenCalled();
    });
    it('retains the unknown-outcome cause after a lost DOM execution result', async () => {
        const page = browser({ clickError: true });
        const error = await generateCommand.func(page, options).catch(e => e);
        expect(error.cause?.code).toBe('command_result_unknown');
        expect(createClicks(page)).toHaveLength(1);
        expect(page.nativeClick).not.toHaveBeenCalled();
        expect(mocks.submit).not.toHaveBeenCalled();
    });
    it('dispatches once when evaluate re-executes after navigation', async () => {
        const page = browser({ replayCreate: true });
        const rows = await generateCommand.func(page, options);
        expect(rows).toHaveLength(2);
        expect(createClicks(page)).toHaveLength(1);
        expect(page.click.mock.calls.every(([selector]) => selector.includes('[role="tab"]'))).toBe(true);
        expect(page.nativeClick).not.toHaveBeenCalled();
        expect(mocks.submit).not.toHaveBeenCalled();
    });
    it('does not submit when sessionStorage cannot hold the single-shot guard', async () => {
        const page = browser({ storageUnavailable: true });
        await expect(generateCommand.func(page, options)).rejects.toThrow('no generation was submitted');
        expect(createClicks(page)).toHaveLength(0);
    });
    it('rejects an optimistic DOM title that was not saved by the server', async () => {
        const page = browser({ saveServerTitle: false });
        await expect(generateCommand.func(page, options)).rejects.toThrow('server did not confirm');
        expect(createClicks(page)).toHaveLength(1);
        expect(mocks.download).not.toHaveBeenCalled();
    });
    it('reports existing ids when title persistence fails, not a new generation request', async () => {
        const page = browser({ saveTitle: false });
        await expect(generateCommand.func(page, options)).rejects.toThrow(`Suno generated ${ids.join(', ')}`);
        expect(createClicks(page)).toHaveLength(1);
        expect(mocks.submit).not.toHaveBeenCalled();
    });
});
