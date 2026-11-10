/**
 * Jimeng image generation.
 *
 * The run loop is exercised against a JSDOM page with scripted DOM steps: the
 * feed here mimics the virtualized result list, where the image count can stay
 * flat while src values rotate (#2421).
 */
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { __test__ } from './generate.js';

const PROMPT = '一只在窗台晒太阳的猫';

function createHarness({
    before = ['https://p3-sign.dreamina-sign/before-1.jpg'],
    steps = [],
    waitSec = 40,
    withEditor = true,
    withButton = true,
} = {}) {
    const dom = new JSDOM(`<body>
      ${withEditor ? '<div id="editor" contenteditable="true"></div>' : ''}
      ${withButton ? '<button id="generate" class="lv-btn lv-btn-primary circle">生成</button>' : ''}
      <div id="feed">${before.map((src) => `<img src="${src}" />`).join('')}</div>
    </body>`, { url: 'https://jimeng.jianying.com/ai-tool/generate?type=image&workspace=0', runScripts: 'outside-only' });
    const doc = dom.window.document;
    const editor = doc.querySelector('#editor');
    const button = doc.querySelector('#generate');
    const feed = doc.querySelector('#feed');
    const inputEvents = [];
    let clicks = 0;
    if (editor) editor.addEventListener('input', (event) => inputEvents.push(event));
    if (button) button.addEventListener('click', () => { clicks += 1; });
    let clock = 0;
    let stepIndex = 0;
    const sleep = async (ms) => {
        clock += ms;
        const step = steps[stepIndex];
        stepIndex += 1;
        if (step) step({ doc, editor, button, feed });
    };
    const result = __test__.generateJimengImage({
        document: doc,
        sleep,
        now: () => clock,
        makeInputEvent: (init) => new dom.window.InputEvent('input', init),
        prompt: PROMPT,
        waitSec,
    });
    return { dom, doc, editor, button, feed, inputEvents, result, clicks: () => clicks };
}

describe('jimeng generate', () => {
    it('inserts the prompt through an InputEvent instead of execCommand', async () => {
        const harness = createHarness({
            steps: [
                () => {},
                () => {},
                ({ button, feed }) => {
                    button.textContent = '生成';
                    feed.innerHTML = '<img src="https://p3-sign.dreamina-sign/after-1.jpg" />';
                },
            ],
        });
        const rows = await harness.result;
        expect(rows[0].status).toBe('success');
        expect(harness.editor.textContent).toBe(PROMPT);
        expect(harness.inputEvents).toHaveLength(1);
        expect(harness.inputEvents[0].inputType).toBe('insertText');
        expect(harness.inputEvents[0].data).toBe(PROMPT);
    });

    it('waits for the 生成中 indicator to start and finish before reading results', async () => {
        const harness = createHarness({
            steps: [
                () => {},
                () => {},
                ({ button }) => { button.textContent = '生成中'; },
                ({ button }) => { button.textContent = '生成'; },
                ({ feed }) => { feed.innerHTML = '<img src="https://p3-sign.dreamina-sign/after-1.jpg" />'; },
            ],
        });
        const rows = await harness.result;
        expect(rows[0]).toMatchObject({
            status: 'success',
            image_count: 1,
            image_urls: 'https://p3-sign.dreamina-sign/after-1.jpg',
        });
        expect(harness.button.textContent).toBe('生成');
    });

    it('detects a new image by src even when the virtualized list keeps the same node count (#2421)', async () => {
        const before = [
            'https://p3-sign.dreamina-sign/old-1.jpg',
            'https://p3-sign.dreamina-sign/old-2.jpg',
            'https://p3-sign.dreamina-sign/old-3.jpg',
            'https://p3-sign.dreamina-sign/old-4.jpg',
        ];
        const after = [
            'https://p3-sign.dreamina-sign/new-1.jpg',
            'https://p3-sign.dreamina-sign/new-2.jpg',
            'https://p3-sign.dreamina-sign/new-3.jpg',
            'https://p3-sign.dreamina-sign/new-4.jpg',
        ];
        const harness = createHarness({
            before,
            steps: [
                () => {},
                () => {},
                ({ feed }) => { feed.innerHTML = after.map((src) => `<img src="${src}" />`).join(''); },
            ],
        });
        const rows = await harness.result;
        expect(rows[0].status).toBe('success');
        // Image count is unchanged (4 -> 4); only the src values rotated.
        expect(harness.feed.querySelectorAll('img')).toHaveLength(4);
        expect(rows[0].image_count).toBe(4);
        for (const src of after) expect(rows[0].image_urls).toContain(src);
    });

    it('reports a timeout without new images', async () => {
        const harness = createHarness({ waitSec: 2 });
        const rows = await harness.result;
        expect(rows[0]).toMatchObject({ status: 'timeout', image_count: 0 });
        expect(harness.clicks()).toBe(1);
    });

    it('fails before clicking when the prompt editor is missing', async () => {
        const harness = createHarness({ withEditor: false });
        const rows = await harness.result;
        expect(rows[0]).toMatchObject({ status: 'failed', image_urls: 'Editor not found' });
        expect(harness.clicks()).toBe(0);
    });

    it('fails before clicking when the generate button is missing', async () => {
        const harness = createHarness({ withButton: false });
        const rows = await harness.result;
        expect(rows[0]).toMatchObject({ status: 'failed', image_urls: 'Generate button not found' });
        expect(harness.inputEvents).toHaveLength(1);
    });
});
